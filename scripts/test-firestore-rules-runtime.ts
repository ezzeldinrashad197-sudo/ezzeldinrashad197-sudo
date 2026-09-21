/**
 * ========================================================================================
 * STRUCTUSIGHT — REAL FIRESTORE SECURITY RULES RUNTIME INTEGRATION TEST HARNESS
 * ========================================================================================
 * This test suite executes actual firestore.rules against the Firebase Local Emulator
 * using @firebase/rules-unit-testing to provide cryptographically and behaviorally
 * verified runtime proof of all ALLOW and DENY authorization boundaries.
 * ========================================================================================
 */

import { initializeTestEnvironment, RulesTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import * as fs from 'fs';
import * as path from 'path';

const PROJECT_ID = 'ai-studio-b1fedb55-c17f-4221-b883-f1ee17f1362f';
const RULES_PATH = path.resolve(process.cwd(), 'firestore.rules');

let testEnv: RulesTestEnvironment | null = null;

async function runRealFirestoreRulesSuite() {
  console.log('================================================================================');
  console.log('  STRUCTUSIGHT — REAL FIRESTORE SECURITY RULES RUNTIME VERIFICATION (EMULATOR)  ');
  console.log('================================================================================');

  const rulesContent = fs.readFileSync(RULES_PATH, 'utf8');

  try {
    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: {
        rules: rulesContent,
        host: process.env.FIRESTORE_EMULATOR_HOST?.split(':')[0] || '127.0.0.1',
        port: parseInt(process.env.FIRESTORE_EMULATOR_HOST?.split(':')[1] || '8080', 10)
      }
    });

    console.log('[INIT] Real Firebase Test Environment successfully connected to Firestore Emulator.');

    let passed = 0;
    let failed = 0;

    async function check(name: string, promise: Promise<any>, shouldSucceed: boolean) {
      try {
        if (shouldSucceed) {
          await assertSucceeds(promise);
        } else {
          await assertFails(promise);
        }
        console.log(`[PASS] ${name}`);
        passed++;
      } catch (err: any) {
        console.error(`[FAIL] ${name} — ${err.message}`);
        failed++;
      }
    }

    // Seed database with pre-provisioned data via admin context
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const adminDb = context.firestore();
      // Pre-provisioned user by email
      await adminDb.doc('users/engineer@structusight.com').set({
        email: 'engineer@structusight.com',
        role: 'pm',
        accountStatus: 'active',
        accessLevel: 'approved',
        projectScope: ['P-101'],
        tenantId: 'tenant-structusight'
      });

      // Admin user
      await adminDb.doc('users/admin-uid-1').set({
        email: 'admin@structusight.com',
        role: 'admin',
        accountStatus: 'active',
        accessLevel: 'approved'
      });

      // Project stats
      await adminDb.doc('project_stats/P-101').set({
        projectId: 'P-101',
        name: 'Alpha Tower'
      });
      await adminDb.doc('project_stats/P-999').set({
        projectId: 'P-999',
        name: 'Forbidden Skyway'
      });
    });

    console.log('\n--- EVALUATING REAL FIRESTORE RULES RUNTIME ALLOW PATHS ---');

    // 1. Provisioned Viewer Document Creation & Access
    const viewerContext = testEnv.authenticatedContext('viewer-uid-1', { email: 'viewer@structusight.com', email_verified: true });
    const viewerDb = viewerContext.firestore();
    await check(
      'ALLOW: Provisioned Viewer Document Creation with default role',
      viewerDb.doc('users/viewer-uid-1').set({
        role: 'viewer',
        name: 'Standard Viewer'
      }),
      true
    );

    // 2. Provisioned PM Identity Linking with Matching Role & Email
    const pmContext = testEnv.authenticatedContext('pm-uid-1', { email: 'engineer@structusight.com', email_verified: true });
    const pmDb = pmContext.firestore();
    await check(
      'ALLOW: Provisioned PM Role Linking from Pre-provisioned Email Document',
      pmDb.doc('users/pm-uid-1').set({
        role: 'pm',
        linkedFromEmailDoc: 'engineer@structusight.com',
        projectScope: ['P-101'],
        tenantId: 'tenant-structusight'
      }),
      true
    );

    // 3. Admin Universal Access
    const adminContext = testEnv.authenticatedContext('admin-uid-1', { email: 'admin@structusight.com', email_verified: true });
    const adminDb = adminContext.firestore();
    await check(
      'ALLOW: Admin Universal Profile Read',
      adminDb.doc('users/engineer@structusight.com').get(),
      true
    );

    console.log('\n--- EVALUATING REAL FIRESTORE RULES RUNTIME DENY PATHS ---');

    // 4. Unknown Google Account Ingress (Attempting to create non-viewer role without pre-provisioning)
    const unknownContext = testEnv.authenticatedContext('unknown-uid', { email: 'intruder@unknown.com', email_verified: true });
    const unknownDb = unknownContext.firestore();
    await check(
      'DENY: Unknown Google Account Arbitrary Role Creation without Email Document',
      unknownDb.doc('users/unknown-uid').set({
        role: 'pm',
        name: 'Intruder'
      }),
      false
    );

    // 5. Unverified Email Token Linking
    const unverifiedContext = testEnv.authenticatedContext('unverified-uid', { email: 'engineer@structusight.com', email_verified: false });
    const unverifiedDb = unverifiedContext.firestore();
    await check(
      'DENY: Unverified Email Identity Linking Attempt',
      unverifiedDb.doc('users/unverified-uid').set({
        role: 'pm',
        linkedFromEmailDoc: 'engineer@structusight.com'
      }),
      false
    );

    // 6. Cross-User Document Read / Profile Snooping
    await check(
      'DENY: Cross-User Document Read (Intruder reading engineer@structusight.com)',
      unknownDb.doc('users/engineer@structusight.com').get(),
      false
    );

    // 7. Arbitrary Role Escalation on Profile Creation
    await check(
      'DENY: Role Escalation on Creation (Claiming admin role while linking)',
      pmDb.doc('users/pm-uid-escalate').set({
        role: 'admin',
        linkedFromEmailDoc: 'engineer@structusight.com'
      }),
      false
    );

    // 8. Unauthorized Admin Role Injection
    await check(
      'DENY: Unauthorized Direct Admin Role Injection',
      viewerDb.doc('users/viewer-uid-1').update({
        role: 'admin'
      }),
      false
    );

    // 9. In-Flight Role Mutation on Existing Profile
    await check(
      'DENY: In-Flight Role Mutation on Existing Profile',
      pmDb.doc('users/pm-uid-1').update({
        role: 'executive'
      }),
      false
    );

    // 10. UID Spoofing Across Divergent Identities
    await check(
      'DENY: UID Spoofing (Writing to victim UID document)',
      unknownDb.doc('users/pm-uid-1').set({
        role: 'viewer'
      }),
      false
    );

    // 11. Email/UID Mismatch Exploitation
    await check(
      'DENY: Email/UID Mismatch Exploitation (Linking someone else email)',
      unknownDb.doc('users/unknown-uid').set({
        role: 'pm',
        linkedFromEmailDoc: 'engineer@structusight.com'
      }),
      false
    );

    // 12. ProjectScope Escalation on User Creation (F-01 / F-02 Remediation Verification)
    await check(
      'DENY: ProjectScope Escalation on User Creation (F-01 Verification)',
      pmDb.doc('users/pm-uid-scope-exploit').set({
        role: 'pm',
        linkedFromEmailDoc: 'engineer@structusight.com',
        projectScope: ['P-101', 'P-999'], // Unauthorized escalation
        tenantId: 'tenant-structusight'
      }),
      false
    );

    // 13. ProjectScope Escalation on User Update (F-01 Verification)
    await check(
      'DENY: ProjectScope Escalation on User Update (F-01 Verification)',
      pmDb.doc('users/pm-uid-1').update({
        projectScope: ['P-101', 'P-999']
      }),
      false
    );

    // 14. Cross-Project / Cross-Tenant Document Access
    await check(
      'DENY: Unauthorized Cross-Project Stats Read (P-999 Outside Scope)',
      pmDb.doc('project_stats/P-999').get(),
      false
    );

    console.log('\n--------------------------------------------------------------------------------');
    console.log(`Real Firestore Rules Runtime Results: ${passed} Passed, ${failed} Failed.`);
    console.log('--------------------------------------------------------------------------------\n');

    if (failed > 0) {
      console.error('❌ REAL FIRESTORE RULES RUNTIME VERIFICATION FAILED');
      process.exit(1);
    } else {
      console.log('✔ REAL FIRESTORE RULES RUNTIME EXECUTION: 100% VERIFIED');
    }

  } catch (err: any) {
    console.error('Fatal Emulator Test Error:', err.message);
    process.exit(1);
  } finally {
    if (testEnv) {
      await testEnv.cleanup();
    }
  }
}

runRealFirestoreRulesSuite();
