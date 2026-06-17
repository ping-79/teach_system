const express = require("express");
const bcrypt = require("bcryptjs");
const prisma = require("../config/prisma");
const { requireAuth } = require("../middleware/auth");
const { pushFlash } = require("../utils/flash");
const { redirectWithSession } = require("../utils/session-redirect");

const router = express.Router();

router.get("/login", (req, res) => {
  if (req.currentUser) {
    return res.redirect("/dashboard");
  }

  return res.render("auth/login", {
    title: "登录",
    pageName: "login"
  });
});

router.post("/auth/login", async (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");

  const user = await prisma.user.findUnique({
    where: { username },
    include: { teacherProfile: true }
  });

  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    pushFlash(req, "error", "账号或密码不正确。");
    return redirectWithSession(req, res, "/login");
  }

  req.session.userId = user.id;
  pushFlash(req, "success", `欢迎回来，${user.teacherProfile?.name || user.username}。`);
  return redirectWithSession(req, res, "/dashboard");
});

router.get("/change-password", requireAuth, (req, res) => {
  res.render("auth/change-password", {
    title: "修改密码",
    pageName: "change-password"
  });
});

router.post("/auth/change-password", requireAuth, async (req, res) => {
  const currentPassword = String(req.body.currentPassword || "");
  const newPassword = String(req.body.newPassword || "");
  const confirmPassword = String(req.body.confirmPassword || "");

  if (newPassword.length < 8) {
    pushFlash(req, "error", "新密码至少需要 8 位。");
    return redirectWithSession(req, res, "/change-password");
  }

  if (newPassword !== confirmPassword) {
    pushFlash(req, "error", "两次输入的新密码不一致。");
    return redirectWithSession(req, res, "/change-password");
  }

  const user = await prisma.user.findUnique({ where: { id: req.currentUser.id } });
  const valid = await bcrypt.compare(currentPassword, user.passwordHash);

  if (!valid) {
    pushFlash(req, "error", "当前密码不正确。");
    return redirectWithSession(req, res, "/change-password");
  }

  await prisma.user.update({
    where: { id: req.currentUser.id },
    data: {
      passwordHash: await bcrypt.hash(newPassword, 10),
      mustChangePassword: false
    }
  });

  pushFlash(req, "success", "密码已更新。");
  return redirectWithSession(req, res, "/dashboard");
});

router.post("/logout", requireAuth, (req, res) => {
  req.session.destroy(() => {
    res.redirect("/login");
  });
});

module.exports = router;
