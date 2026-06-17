const prisma = require("../config/prisma");
const { pushFlash } = require("../utils/flash");
const { redirectWithSession } = require("../utils/session-redirect");

async function attachCurrentUser(req, res, next) {
  res.locals.currentUser = null;

  if (!req.session.userId) {
    return next();
  }

  const user = await prisma.user.findUnique({
    where: { id: req.session.userId },
    include: { teacherProfile: true }
  });

  if (!user) {
    req.session.destroy(() => {});
    return next();
  }

  req.currentUser = user;
  res.locals.currentUser = user;
  next();
}

function requireAuth(req, res, next) {
  if (!req.currentUser) {
    pushFlash(req, "error", "请先登录系统。");
    return redirectWithSession(req, res, "/login");
  }

  next();
}

function requireAdmin(req, res, next) {
  if (!req.currentUser || req.currentUser.role !== "admin") {
    pushFlash(req, "error", "当前账号没有管理员权限。");
    return redirectWithSession(req, res, "/dashboard");
  }

  next();
}

function requirePasswordChange(req, res, next) {
  const allowList = new Set(["/change-password", "/auth/change-password", "/logout"]);
  if (req.currentUser && req.currentUser.mustChangePassword && !allowList.has(req.path)) {
    pushFlash(req, "warning", "首次登录请先修改密码。");
    return redirectWithSession(req, res, "/change-password");
  }

  next();
}

module.exports = {
  attachCurrentUser,
  requireAuth,
  requireAdmin,
  requirePasswordChange
};
