const path = require("path");
const express = require("express");
const session = require("express-session");
const FileStore = require("session-file-store")(session);
const env = require("./config/env");
const prisma = require("./config/prisma");
const { ensureDirectories } = require("./utils/ensure-directories");
const { consumeFlash } = require("./utils/flash");
const viewHelpers = require("./utils/view-helpers");
const { attachCurrentUser, requirePasswordChange } = require("./middleware/auth");

const authRoutes = require("./routes/auth");
const dashboardRoutes = require("./routes/dashboard");
const lessonPlanRoutes = require("./routes/lesson-plan");
const semesterRoutes = require("./routes/semesters");
const offeringRoutes = require("./routes/offerings");
const contentLibraryRoutes = require("./routes/content-library");
const teacherProfileRoutes = require("./routes/teacher-profile");
const achievementRoutes = require("./routes/achievements");
const adminRoutes = require("./routes/admin");

ensureDirectories([env.uploadsDir, env.exportsDir, env.sessionsDir]);

const app = express();

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.locals.helpers = viewHelpers;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(env.rootDir, "public")));
const sessionOptions = {
  secret: env.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 1000 * 60 * 60 * 8
  }
};

if (process.platform !== "win32") {
  sessionOptions.store = new FileStore({
    path: env.sessionsDir,
    retries: 0
  });
}

app.use(session(sessionOptions));

app.use(attachCurrentUser);
app.use((req, res, next) => {
  res.locals.flashMessages = consumeFlash(req);
  res.locals.requestPath = req.path;
  res.locals.lessonPlanUrl = env.lessonPlanUrl;
  next();
});
app.use(requirePasswordChange);

app.use(authRoutes);
app.use(dashboardRoutes);
app.use(lessonPlanRoutes);
app.use(semesterRoutes);
app.use(offeringRoutes);
app.use(contentLibraryRoutes);
app.use(teacherProfileRoutes);
app.use(achievementRoutes);
app.use(adminRoutes);

app.use((req, res) => {
  res.status(404).render("partials/error-page", {
    title: "页面未找到",
    pageName: "error",
    message: "你访问的页面不存在。"
  });
});

app.use((error, req, res, next) => {
  console.error(error);
  if (res.headersSent) {
    return next(error);
  }
  res.status(500).render("partials/error-page", {
    title: "系统错误",
    pageName: "error",
    message: error.message || "系统暂时不可用。"
  });
});

const server = app.listen(env.port, () => {
  console.log(`Teaching materials system running at http://localhost:${env.port}`);
});

process.on("SIGINT", async () => {
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
});
