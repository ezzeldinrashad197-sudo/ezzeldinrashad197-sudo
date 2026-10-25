import express from "express";
import path from "path";
import fs from "fs";
import { GoogleGenAI } from "@google/genai";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import NodeCache from "node-cache";
import { 
  buildCanonicalDataset, 
  evaluatePerformanceLayer 
} from "./analytics/calculationFoundation";

// Initialize cache
const cache = new NodeCache({ stdTTL: 600 }); // 10 minutes cache

// --- ENTERPRISE OBSERVABILITY & TELEMETRY REGISTRY (Issue #10) ---
const systemMetrics = {
  totalRequests: 0,
  startTime: Date.now(),
  aiRequests: 0,
  aiFailures: 0,
  aiModelSuccesses: {} as Record<string, number>,
  corsBlockedCount: 0,
  activeJobsCount: 0,
  cacheHits: 0,
  selfTestsExecuted: 0,
  selfTestsPassed: 0,
  securityWarningsLogged: 0,
  rateLimitIncidentsCount: 0,
  circuitBreakerTrippings: 0,
  exportFailures: 0,
};

const securityLogs: any[] = [];
const activeJobs = new Map<string, any>();
const completedJobsHistory: any[] = [];

const logSecurityEvent = (type: string, severity: 'INFO' | 'WARN' | 'CRITICAL', message: string, details?: any) => {
  const timestamp = new Date().toISOString();
  const event = { timestamp, type, severity, message, details };
  securityLogs.unshift(event);
  if (securityLogs.length > 500) securityLogs.pop(); // bound memory size
  if (severity === 'WARN' || severity === 'CRITICAL') {
    systemMetrics.securityWarningsLogged++;
  }
};

// --- CIRCUIT BREAKER ARCHITECTURE Pattern (Issue #7) ---
class CircuitBreaker {
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
  private failureCount: number = 0;
  private lastFailureTime: number = 0;
  private readonly threshold: number;
  private readonly timeout: number;

  constructor(threshold = 3, timeout = 30000) {
    this.threshold = threshold;
    this.timeout = timeout;
  }

  public recordSuccess() {
    this.failureCount = 0;
    this.state = 'CLOSED';
  }

  public recordFailure() {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    if (this.failureCount >= this.threshold) {
      this.state = 'OPEN';
      systemMetrics.circuitBreakerTrippings++;
      logSecurityEvent('CIRCUIT_BREAKER_TRIPPED', 'CRITICAL', 'AI processing circuit breaker tripped open due to repeated upstream failures.');
    }
  }

  public canExecute(): boolean {
    if (this.state === 'CLOSED') return true;
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime > this.timeout) {
        this.state = 'HALF_OPEN';
        logSecurityEvent('CIRCUIT_BREAKER_HALF_OPEN', 'WARN', 'Testing AI API stability in HALF_OPEN state.');
        return true;
      }
      return false;
    }
    return true; // HALF_OPEN allows single execution attempt
  }

  public getState() {
    return this.state;
  }
}

const aiCircuitBreaker = new CircuitBreaker(3, 30000);

export async function createApp(opts?: { skipVite?: boolean }) {
  // --- VERIFY CRITICAL RUNTIME ENVIRONMENT ON STARTUP (Issue #5) ---
  if (!process.env.GEMINI_API_KEY) {
     console.warn("\n=========================================================================================");
     console.warn("\x1b[33m%s\x1b[0m", "[Production Security Alert] GEMINI_API_KEY environment variable is NOT set.");
     console.warn("\x1b[33m%s\x1b[0m", "AI Insights Advice and Summarization capabilities will be disabled until configured.");
     console.warn("\x1b[33m%s\x1b[0m", "Please assign GEMINI_API_KEY under the App Settings or in an active .env context.");
     console.warn("\x1b[33m%s\x1b[0m", "=========================================================================================\n");
  }

  const app = express();
  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

  const isProd =
    process.env.NODE_ENV === "production" ||
    Boolean(process.env.K_SERVICE) ||
    Boolean(process.env.PORT && process.env.PORT !== "3000");
  const isDev = !isProd;

  // Track all incoming API requests (Issue #10)
  app.use((req, res, next) => {
    systemMetrics.totalRequests++;
    next();
  });

  // 1. Security headers & safely configured CSP (Restricts unsafe script permissions in production)
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: isProd
          ? ["'self'", "https://cdn.jsdelivr.net", "https://apis.google.com", "https://accounts.google.com"]
          : ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://cdn.jsdelivr.net", "https://apis.google.com", "https://accounts.google.com"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
        imgSrc: ["'self'", "data:", "blob:", "https:", "*"], 
        connectSrc: ["'self'", "https:", "wss:", "ws:", "https://*.googleapis.com", "https://*.firebaseapp.com"],
        frameAncestors: ["'self'", "https://*.google.com", "https://*.run.app"],
        frameSrc: ["'self'", "https://accounts.google.com", "https://*.firebaseapp.com"],
        objectSrc: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
    referrerPolicy: { policy: "no-referrer" },
  }));

  // 2. Strict / Secure CORS Policy (Issue #8)
  const allowedOrigins = [
    /^http:\/\/localhost:\d+$/,
    /^http:\/\/127\.0\.0\.1:\d+$/,
    /^https:\/\/.*\.run\.app$/,
    /^https:\/\/.*\.google\.com$/,
  ];

  app.use(cors({
    origin: (origin, callback) => {
      // Allow browser same-origin/internal requests or tools where origin header is undefined
      if (!origin) return callback(null, true);
      const isAllowed = allowedOrigins.some(pattern => pattern.test(origin));
      if (isAllowed) {
        callback(null, true);
      } else {
        systemMetrics.corsBlockedCount++;
        logSecurityEvent('CORS_VIOLATION', 'WARN', `Blocked unauthorized origin: ${origin}`);
        callback(new Error(`CORS Policy: Origin ${origin} not authorized.`));
      }
    },
    credentials: true,
  }));

  // 3. Rate Limiting Policy for API Protection (Issue #8)
  const apiLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 120, // 120 requests per minute per IP
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res, next, options) => {
      systemMetrics.rateLimitIncidentsCount++;
      logSecurityEvent('RATE_LIMIT_EXCEEDED', 'WARN', `Rate limit exceeded for IP: ${req.ip}`);
      res.status(options.statusCode).json({ error: "Too many requests. Please throttle your sync." });
    }
  });

  const aiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 20, // 20 AI requests per minute
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res, next, options) => {
      systemMetrics.rateLimitIncidentsCount++;
      logSecurityEvent('AI_RATE_LIMIT_EXCEEDED', 'WARN', `AI generation throttle exceeded for IP: ${req.ip}`);
      res.status(options.statusCode).json({ error: "AI generation rate limit reached. Please wait before generating further insights." });
    }
  });

  app.use("/api/", apiLimiter);

  // 4. Request Body Parsers with Protected Limits (50mb for batch Excel uploads, 1mb for others)
  app.use("/api/upload", express.json({ limit: "50mb" }));
  app.use("/api/upload", express.urlencoded({ extended: true, limit: "50mb" }));
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true, limit: "1mb" }));

  // API Routes
  app.get(["/healthz", "/api/health"], (req, res) => {
    res.json({ 
      status: "ok", 
      time: new Date().toISOString(),
      governedLimit: "50MB (Batch Datasets) | Standard API: 1MB",
      activeQueueCount: activeJobs.size
    });
  });

  app.get("/api/verification-report", (_req, res) => {
    const reportPath = path.resolve(process.cwd(), "src/docs/STRUCTUSIGHT_ENGINEERING_VERIFICATION_AND_GATE_STATUS_REPORT_2026-10-14.md");
    if (fs.existsSync(reportPath)) {
      res.setHeader("Content-Type", "text/markdown; charset=utf-8");
      res.sendFile(reportPath);
    } else {
      res.status(404).send("Report not found");
    }
  });

  // Export verification PDF binary endpoint (Task 4)
  app.get("/api/verification-pdf", (_req, res) => {
    const pdfPath = path.resolve(process.cwd(), "evidence/certification/StructuSight-NCR-Verification.pdf");
    if (fs.existsSync(pdfPath)) {
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", 'attachment; filename="StructuSight-NCR-Verification.pdf"');
      res.sendFile(pdfPath);
    } else {
      res.status(404).json({ error: "Verification PDF not found on server." });
    }
  });

  // Export verification PPTX binary endpoint (Task 4)
  app.get("/api/verification-pptx", (_req, res) => {
    const pptxPath = path.resolve(process.cwd(), "evidence/certification/StructuSight-NCR-Verification.pptx");
    if (fs.existsSync(pptxPath)) {
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.presentationml.presentation");
      res.setHeader("Content-Disposition", 'attachment; filename="StructuSight-NCR-Verification.pptx"');
      res.sendFile(pptxPath);
    } else {
      res.status(404).json({ error: "Verification PPTX not found on server." });
    }
  });

  // Production Disaster Recovery Runbook Endpoint (Task 4)
  app.get("/api/disaster-recovery", (_req, res) => {
    const runbookPath = path.resolve(process.cwd(), "DISASTER_RECOVERY.md");
    if (fs.existsSync(runbookPath)) {
      res.setHeader("Content-Type", "text/markdown; charset=utf-8");
      res.sendFile(runbookPath);
    } else {
      res.status(404).send("Disaster recovery runbook not found");
    }
  });

  // Task 4: Export Health Check Endpoint
  app.get("/api/export-health", (_req, res) => {
    const pdfPath = path.resolve(process.cwd(), "evidence/certification/StructuSight-NCR-Verification.pdf");
    const pptxPath = path.resolve(process.cwd(), "evidence/certification/StructuSight-NCR-Verification.pptx");
    const pdfExists = fs.existsSync(pdfPath);
    const pptxExists = fs.existsSync(pptxPath);
    const pdfStats = pdfExists ? fs.statSync(pdfPath) : null;
    const pptxStats = pptxExists ? fs.statSync(pptxPath) : null;
    res.json({
      status: (pdfExists && pptxExists) ? "HEALTHY" : "DEGRADED",
      verifiedAt: new Date().toISOString(),
      pdf: {
        available: pdfExists,
        sizeBytes: pdfStats?.size || 0,
        path: "evidence/certification/StructuSight-NCR-Verification.pdf"
      },
      pptx: {
        available: pptxExists,
        sizeBytes: pptxStats?.size || 0,
        path: "evidence/certification/StructuSight-NCR-Verification.pptx"
      },
      exportFailures: systemMetrics.exportFailures
    });
  });

  // Task 4: Trace Export Activity Endpoint
  app.post("/api/export-trace", (req, res) => {
    const { format, documentType, status, recordCount, error } = req.body || {};
    if (error || status === 'FAILED') {
      systemMetrics.exportFailures++;
      logSecurityEvent('EXPORT_FAILURE', 'WARN', `Export failed for format ${format} on ${documentType}: ${error || 'Unknown'}`);
    }
    res.json({ recorded: true, timestamp: new Date().toISOString() });
  });

  // --- COMPREHENSIVE PRODUCTION SYSTEM TELEMETRY (Issue #10) ---
  app.get("/api/metrics", (_req, res) => {
    const mem = process.memoryUsage();
    res.json({
      uptimeSeconds: Math.round((Date.now() - systemMetrics.startTime) / 1000),
      memory: {
        rssMB: Math.round(mem.rss / 1024 / 1024),
        heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024),
        heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
        externalMB: Math.round(mem.external / 1024 / 1024),
      },
      requests: {
        totalRequests: systemMetrics.totalRequests,
        corsBlockedCount: systemMetrics.corsBlockedCount,
        rateLimitIncidentsCount: systemMetrics.rateLimitIncidentsCount,
      },
      aiSystem: {
        totalRequests: systemMetrics.aiRequests,
        totalFailures: systemMetrics.aiFailures,
        successRatePercentage: systemMetrics.aiRequests > 0 
          ? Number((((systemMetrics.aiRequests - systemMetrics.aiFailures) / systemMetrics.aiRequests) * 100).toFixed(1))
          : 100,
        modelSuccessDistribution: systemMetrics.aiModelSuccesses,
        activeJobsCount: systemMetrics.activeJobsCount,
        cacheHits: systemMetrics.cacheHits,
        circuitBreakerState: aiCircuitBreaker.getState(),
        circuitBreakerTrippings: systemMetrics.circuitBreakerTrippings
      },
      verificationSuite: {
        selfTestsExecuted: systemMetrics.selfTestsExecuted,
        selfTestsPassed: systemMetrics.selfTestsPassed,
        allPassing: systemMetrics.selfTestsExecuted > 0 && systemMetrics.selfTestsExecuted === systemMetrics.selfTestsPassed
      },
      securityWarningsLogged: systemMetrics.securityWarningsLogged
    });
  });

  // Active AI Processing Queue endpoint (Issue #7)
  app.get("/api/jobs/active", (_req, res) => {
    const jobs = Array.from(activeJobs.values());
    res.json({
      activeCount: jobs.length,
      jobs,
      recentCompleted: completedJobsHistory.slice(0, 10)
    });
  });

  // Security Incident Audit Log endpoint (Issue #8)
  app.get("/api/security-audit", (_req, res) => {
    res.json({
      totalLogged: securityLogs.length,
      events: securityLogs.slice(0, 50)
    });
  });

  // Database Connection Diagnostics
  app.get("/api/database-status", async (_req, res) => {
    try {
      const databaseUrl = process.env.DATABASE_URL;
      if (!databaseUrl) {
        return res.json({
          status: "NOT_CONFIGURED",
          provider: "cloud_sql_postgres",
          message: "DATABASE_URL not set. Running in serverless/offline mode."
        });
      }

      const { Pool } = await import("pg");
      const pool = new Pool({
        connectionString: databaseUrl,
        connectionTimeoutMillis: 3000,
      });

      const client = await pool.connect();
      const result = await client.query("SELECT NOW() as current_time, current_database() as db_name;");
      client.release();
      await pool.end();

      res.json({
        status: "CONNECTED",
        provider: "cloud_sql_postgres",
        database: result.rows[0].db_name,
        serverTime: result.rows[0].current_time,
      });
    } catch (err: any) {
      logSecurityEvent('DATABASE_CHECK_FAILED', 'WARN', `Database probe failed: ${err.message}`);
      res.status(503).json({
        status: "UNREACHABLE",
        provider: "cloud_sql_postgres",
        error: err.message
      });
    }
  });

  // System Diagnostics & Self-Test Endpoint (Issue #9)
  app.get("/api/self-test", async (_req, res) => {
    const testResults: any = {
      timestamp: new Date().toISOString(),
      tests: [],
      overallStatus: "PASS"
    };

    systemMetrics.selfTestsExecuted++;

    // Test 1: Node & Process Environment
    testResults.tests.push({
      name: "Node Environment Execution",
      status: "PASS",
      details: { nodeVersion: process.version, platform: process.platform }
    });

    // Test 2: In-Memory Cache Verification
    try {
      const testKey = `test_${Date.now()}`;
      cache.set(testKey, "valid");
      const val = cache.get(testKey);
      cache.del(testKey);
      testResults.tests.push({
        name: "Telemetry Cache Memory Engine",
        status: val === "valid" ? "PASS" : "FAIL",
        details: "NodeCache engine functional"
      });
    } catch (cacheErr: any) {
      testResults.tests.push({ name: "Telemetry Cache Memory Engine", status: "FAIL", error: cacheErr.message });
      testResults.overallStatus = "FAIL";
    }

    // Test 3: AI Connectivity Configuration Check
    const hasKey = Boolean(process.env.GEMINI_API_KEY);
    testResults.tests.push({
      name: "Gemini API Configuration Credentials",
      status: hasKey ? "PASS" : "WARN",
      details: hasKey ? "API Key loaded" : "GEMINI_API_KEY absent. Insights will fallback to offline notice."
    });

    // Test 4: Circuit Breaker Readiness
    testResults.tests.push({
      name: "AI Circuit Breaker State",
      status: aiCircuitBreaker.getState() === 'OPEN' ? "WARN" : "PASS",
      details: `Current state: ${aiCircuitBreaker.getState()}`
    });

    if (testResults.overallStatus === "PASS") {
      systemMetrics.selfTestsPassed++;
    }

    res.json(testResults);
  });

  // Calculate Metrics endpoint
  app.post("/api/metrics/calculate", (req, res) => {
    try {
      const { rawData, filters } = req.body;
      if (!Array.isArray(rawData)) {
        return res.status(400).json({ error: "Invalid data format. Expected an array of records." });
      }

      const filterOpt = (val: any, opt: any) => {
        if (!opt || opt === 'ALL') return true;
        if (Array.isArray(opt)) return opt.length === 0 || opt.includes(val);
        return String(val || '').toLowerCase() === String(opt).toLowerCase();
      };

      const filtered = rawData.filter(row => {
        if (filters?.discipline && !filterOpt(row.discipline, filters.discipline)) return false;
        if (filters?.documentType && !filterOpt(row.documentType || row.logType, filters.documentType)) return false;
        if (filters?.status && !filterOpt(row.status, filters.status)) return false;
        if (filters?.area && !filterOpt(row.area, filters.area)) return false;
        if (filters?.tradeSystem && !filterOpt(row.tradeSystem, filters.tradeSystem)) return false;
        return true;
      });

      // Delegate calculation directly to SSOT Canonical Foundation Engine
      const canonicalRecords = buildCanonicalDataset(filtered, rawData);
      const perfResult = evaluatePerformanceLayer(canonicalRecords);

      res.json({
        status: "success",
        engineVersion: "2.1.0-ENTERPRISE-SSOT",
        filtersApplied: filters || {},
        metrics: {
          totalRecords: perfResult.totalUniqueItems,
          openRecords: perfResult.rejectedOpen + perfResult.pending,
          closedRecords: perfResult.approved + perfResult.rejectedClosed,
          approvedRecords: perfResult.approved,
          rejectedOpenRecords: perfResult.rejectedOpen,
          rejectedClosedRecords: perfResult.rejectedClosed,
          pendingRecords: perfResult.pending,
          qualityScore: perfResult.totalUniqueItems > 0 
            ? Number(((perfResult.approved / perfResult.totalUniqueItems) * 100).toFixed(1)) 
            : 100
        },
        records: canonicalRecords
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message || "Failed to calculate metrics" });
    }
  });

  // Gemini AI Insights Proxy Endpoint with Rate Limiting, Smart Curation & Fallbacks
  app.post("/api/insights", aiLimiter, async (req, res) => {
    systemMetrics.aiRequests++;

    // Check circuit breaker first
    if (!aiCircuitBreaker.canExecute()) {
      return res.status(503).json({
        error: "AI Services temporarily unavailable due to recent downstream rate limits or outages. Circuit breaker is currently open. Please try again shortly."
      });
    }

    const jobId = `job_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    try {
      const { stats, totalRecords, projectName, healthScore, consultantAnalytics, contractorAnalytics, disciplineAnalytics, overdueAnalytics, reworkAnalytics, rootCauseAnalytics, forecastAnalytics, auditAnalytics } = req.body;

      // Smart Payload Curation (Issue #6)
      const payloadString = JSON.stringify(req.body);
      
      const smartGovernorCuration = (sectionKey: string, dataArray: any[]) => {
        if (!Array.isArray(dataArray)) return dataArray;
        if (dataArray.length <= 15) return dataArray;
        
        const topImpact = dataArray.slice(0, 15);
        const remainder = dataArray.slice(15);
        
        const aggregatedRest = {
          category: `Other ${remainder.length} Elements (Enterprise Curation Summary)`,
          count: remainder.reduce((acc, current) => acc + Number(current.count || current.total || current.value || 0), 0),
          delayDays: Math.round(remainder.reduce((acc, current) => acc + Number(current.delayDays || current.overdueDays || 0), 0) / (remainder.length || 1)),
          impactRatingDetail: "Curation aggregation performed by AI Processing Protection Layer to bypass payload size overflows."
        };
        
        return [...topImpact, aggregatedRest];
      };

      const crypto = await import('crypto');
      const cacheKey = `insights_${projectName}_${crypto.createHash('md5').update(payloadString).digest('hex')}`;
      const cachedInsights = cache.get(cacheKey);
      if (cachedInsights) {
        systemMetrics.cacheHits++;
        return res.json({ insights: cachedInsights });
      }

      if (!process.env.GEMINI_API_KEY) {
        return res.status(500).json({ error: "GEMINI_API_KEY is not configured on the server." });
      }

      // Track active queue jobs (Issue #7)
      const jobRecord = {
        id: jobId,
        type: 'ai_insights',
        projectName,
        status: 'running',
        startTime: Date.now(),
        memoryOnStart: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB'
      };
      activeJobs.set(jobId, jobRecord);
      systemMetrics.activeJobsCount = activeJobs.size;

      // Smart governance compiled structure
      const aiInput = {
        totalRecordsProcessed: totalRecords,
        projectHealthScore: healthScore || "Not Implemented",
        consultantAnalytics: smartGovernorCuration('consultant', consultantAnalytics) || "Not Implemented",
        contractorAnalytics: smartGovernorCuration('contractor', contractorAnalytics) || "Not Implemented",
        disciplineAnalytics: smartGovernorCuration('discipline', disciplineAnalytics) || "Not Implemented",
        overdueAnalytics: smartGovernorCuration('overdue', overdueAnalytics) || "Not Implemented",
        reworkAnalytics: smartGovernorCuration('rework', reworkAnalytics) || "Not Implemented",
        rootCauseAnalytics: smartGovernorCuration('rootcause', rootCauseAnalytics) || "Not Implemented",
        forecastAnalytics: smartGovernorCuration('forecast', forecastAnalytics) || "Not Implemented",
        auditAnalytics: smartGovernorCuration('audit', auditAnalytics) || "Not Implemented"
      };

      const ai = new GoogleGenAI({ 
        apiKey: process.env.GEMINI_API_KEY,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build-hardened-v2',
          }
        }
      });

      const prompt = `
You are a Senior Project Controls Director and Executive Reporting Specialist.

Analyze the comprehensive enterprise data payload for the project "${projectName || 'Unknown Project'}".

Enterprise Intelligence Payload:
${JSON.stringify(aiInput, null, 2)}

Generate the report in the following format:
# Executive Summary
(A concise executive overview of project document control performance, incorporating Health Score and Contractor/Consultant efficiency)

# Key Findings
(Highlight the most important observations from the discipline, consultant, and contractor analytics)

# Root Cause Analysis
(Analyze primary reasons for delays and rejections based on rework/root cause data)

# Critical Risks
(Identify current and future risks based on overdue trends and audit analytics)

# Forecast
(Predict expected performance trends using forecast data)

# Action Plan
(Specific corrective actions and management recommendations)

Keep the report concise, professional, and use Markdown headings and bullet points. Do not include placeholder text. If any metric is marked "Not Implemented", do not guess it.
`;

      // --- MODEL NAME ENVIRONMENT BOUND CONFIG & FALLBACK POLICY (Issue #5) ---
      const preferredModel = process.env.GEMINI_MODEL || "gemini-3.5-flash";
      const fallbacks = ["gemini-2.5-flash", "gemini-1.5-flash"];
      const modelSequence = [preferredModel, ...fallbacks];
      
      let insightsResult = "";
      let activeError: any = null;
      let usedModelName = "";

      for (const targetModel of modelSequence) {
        usedModelName = targetModel;
        try {
          // Wrapped Promise Timeout (Issue #5)
          const apiPromise = ai.models.generateContent({
            model: targetModel,
            contents: prompt
          });

          const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error(`Timeout: Gemini request exceeded safety threshold (32s limit) for ${targetModel}`)), 32000);
          });

          const result = await Promise.race([apiPromise, timeoutPromise]);
          insightsResult = result.text || "";
          activeError = null;
          break; // Succeeded! Break loop
        } catch (apiErr: any) {
          activeError = apiErr;
          console.warn(`[API Fallback Logger] Failed model ${targetModel}, trying next model. Error: ${apiErr.message}`);
          logSecurityEvent('AI_FALLBACK_TRIGGERED', 'WARN', `Gemini model ${targetModel} failed, triggering next fallback.`, { error: apiErr.message });
        }
      }

      if (activeError || !insightsResult) {
        throw new Error(activeError ? activeError.message : "All model fallback endpoints exhausted.");
      }

       systemMetrics.aiModelSuccesses[usedModelName] = (systemMetrics.aiModelSuccesses[usedModelName] || 0) + 1;
      aiCircuitBreaker.recordSuccess();

      // Update background completed job tracks (Issue #7)
      jobRecord.status = 'completed';
      const duration = Date.now() - jobRecord.startTime;
      (jobRecord as any).duration = duration;
      (jobRecord as any).memoryOnEnd = Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB';
      (jobRecord as any).modelUsed = usedModelName;
      completedJobsHistory.unshift({...jobRecord});
      if (completedJobsHistory.length > 50) completedJobsHistory.pop();
      activeJobs.delete(jobId);
      systemMetrics.activeJobsCount = activeJobs.size;

      // Cache the completed insights response
      cache.set(cacheKey, insightsResult);
      res.json({ insights: insightsResult });
    } catch (error: any) {
      systemMetrics.aiFailures++;
      aiCircuitBreaker.recordFailure();
      logSecurityEvent('AI_EXECUTION_FAILURE', 'CRITICAL', `Gemini execution failure targeting ${projectName}: ${error.message}`);
      
      // Update background completed job as failed (Issue #7)
      const runningJob = activeJobs.get(jobId);
      if (runningJob) {
        runningJob.status = 'failed';
        runningJob.error = error.message;
        completedJobsHistory.unshift({...runningJob});
        activeJobs.delete(jobId);
        systemMetrics.activeJobsCount = activeJobs.size;
      }

      console.error("Gemini API Error:", error);
      res.status(500).json({ error: error.message || "Failed to generate insights." });
    }
  });

  // Vite middleware for development (skipped during unit/integration tests)
  if (isDev && !opts?.skipVite) {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else if (!isDev) {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*all', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  return app;
}

export async function startServer() {
  const app = await createApp();
  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
  return new Promise<any>((resolve) => {
    const s = app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on http://0.0.0.0:${PORT}`);
      resolve(s);
    });
  });
}

if (process.env.NODE_ENV !== 'test' && !process.env.SKIP_SERVER_AUTOSTART) {
  startServer();
}
