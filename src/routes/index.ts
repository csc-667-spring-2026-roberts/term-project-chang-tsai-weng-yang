import { Router } from "express";
import { createHash } from "crypto";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

router.get("/", (req, res) => {
  const authMode =
    req.query.auth === "register" || req.query.auth === "login" ? req.query.auth : "login";
  const error = typeof req.query.error === "string" ? req.query.error : "";
  const email = typeof req.query.email === "string" ? req.query.email : "";
  const redirectTo = typeof req.query.redirectTo === "string" ? req.query.redirectTo : "/";
  const signedInEmail = req.session.userEmail;
  const gravatarUrl =
    req.session.userId && signedInEmail
      ? `https://www.gravatar.com/avatar/${createHash("md5")
          .update(signedInEmail.trim().toLowerCase())
          .digest("hex")}?d=identicon&s=160`
      : "";

  res.render("home", {
    title: "Gin Rummy",
    user:
      req.session.userId && req.session.userEmail
        ? {
            id: req.session.userId,
            email: req.session.userEmail,
            gravatarUrl,
          }
        : null,
    showAuthModal: Boolean(error),
    authMode,
    error,
    email,
    redirectTo,
  });
});

router.get("/about", requireAuth, (req, res) => {
  res.render("about", {
    title: "About",
    user: {
      id: req.session.userId,
      email: req.session.userEmail,
      gravatarUrl: "",
    },
  });
});

router.get("/rules", requireAuth, (req, res) => {
  res.render("rules", {
    title: "Rules",
    user: {
      id: req.session.userId,
      email: req.session.userEmail,
      gravatarUrl: "",
    },
  });
});

export default router;
