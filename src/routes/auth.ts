import express, { Request, Response } from "express";
import bcrypt from "bcrypt";
import pool from "../db.js";

const router = express.Router();
const SALT_ROUNDS = 10;

interface AuthBody {
  email: string;
  password: string;
  origin?: string;
  redirectTo?: string;
}

interface ExistingUserRow {
  id: number;
}

interface RegisteredUserRow {
  id: number;
  email: string;
  created_at: string;
}

interface LoginUserRow {
  id: number;
  email: string;
  password_hash: string;
}

interface AuthViewModel {
  title: string;
  error?: string;
  email?: string;
  redirectTo?: string;
}

function getAuthViewModel(
  title: string,
  viewModel: Partial<AuthViewModel> = {},
): Required<AuthViewModel> {
  return {
    title,
    error: viewModel.error ?? "",
    email: viewModel.email ?? "",
    redirectTo: viewModel.redirectTo ?? "",
  };
}

function getSafeRedirectPath(path: string | undefined): string {
  if (path === "/about" || path === "/rules" || path === "/") {
    return path;
  }

  return "/";
}

function renderLogin(res: Response, viewModel: AuthViewModel = { title: "Login" }): void {
  res.status(200).render("auth/login", getAuthViewModel("Login", viewModel));
}

function renderRegister(res: Response, viewModel: AuthViewModel = { title: "Register" }): void {
  res.status(200).render("auth/register", getAuthViewModel("Register", viewModel));
}

function redirectToHomeAuth(
  res: Response,
  auth: "login" | "register",
  error: string,
  email: string,
  redirectTo: string,
): void {
  const params = new URLSearchParams({
    auth,
    error,
    email,
    redirectTo,
  });

  res.redirect(`/?${params.toString()}`);
}

function handleAuthError(
  res: Response,
  auth: "login" | "register",
  fromHome: boolean,
  error: string,
  email: string,
  redirectTo: string,
): void {
  if (fromHome) {
    redirectToHomeAuth(res, auth, error, email, redirectTo);
    return;
  }

  if (auth === "login") {
    renderLogin(res, {
      title: "Login",
      error,
      email,
      redirectTo,
    });
    return;
  }

  renderRegister(res, {
    title: "Register",
    error,
    email,
    redirectTo,
  });
}

router.get("/login", (req: Request, res: Response): void => {
  if (req.session.userId) {
    res.redirect("/");
    return;
  }

  renderLogin(res, { title: "Login" });
});

router.get("/register", (req: Request, res: Response): void => {
  if (req.session.userId) {
    res.redirect("/");
    return;
  }

  renderRegister(res, { title: "Register" });
});

router.post("/register", async (req: Request<object, object, AuthBody>, res: Response) => {
  try {
    const { email, password } = req.body;
    const fromHome = req.body.origin === "home";
    const redirectTo = getSafeRedirectPath(req.body.redirectTo);

    if (!email || !password) {
      handleAuthError(
        res,
        "register",
        fromHome,
        "Email and password are required",
        email,
        redirectTo,
      );
      return;
    }

    if (password.length < 6) {
      handleAuthError(
        res,
        "register",
        fromHome,
        "Password must be at least 6 characters",
        email,
        redirectTo,
      );
      return;
    }

    const existingUser = await pool.query<ExistingUserRow>(
      "SELECT id FROM users WHERE email = $1",
      [email],
    );

    if (existingUser.rows.length > 0) {
      handleAuthError(res, "register", fromHome, "User already exists", email, redirectTo);
      return;
    }

    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

    const result = await pool.query<RegisteredUserRow>(
      "INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email, created_at",
      [email, hashedPassword],
    );

    const user = result.rows[0];
    if (!user) {
      handleAuthError(res, "register", fromHome, "Server error", email, redirectTo);
      return;
    }

    req.session.userId = user.id;
    req.session.userEmail = user.email;

    res.redirect(redirectTo);
    return;
  } catch (error) {
    console.error("Register error:", error);
    handleAuthError(
      res,
      "register",
      req.body.origin === "home",
      "Server error",
      req.body.email,
      getSafeRedirectPath(req.body.redirectTo),
    );
  }
});

router.post("/login", async (req: Request<object, object, AuthBody>, res: Response) => {
  try {
    const { email, password } = req.body;
    const fromHome = req.body.origin === "home";
    const redirectTo = getSafeRedirectPath(req.body.redirectTo);

    if (!email || !password) {
      handleAuthError(res, "login", fromHome, "Email and password are required", email, redirectTo);
      return;
    }

    const result = await pool.query<LoginUserRow>(
      "SELECT id, email, password_hash FROM users WHERE email = $1",
      [email],
    );

    if (result.rows.length === 0) {
      handleAuthError(res, "login", fromHome, "Invalid email or password", email, redirectTo);
      return;
    }

    const user = result.rows[0];
    if (!user) {
      handleAuthError(res, "login", fromHome, "Invalid email or password", email, redirectTo);
      return;
    }

    const passwordMatch = await bcrypt.compare(password, user.password_hash);

    if (!passwordMatch) {
      handleAuthError(res, "login", fromHome, "Invalid email or password", email, redirectTo);
      return;
    }

    req.session.userId = user.id;
    req.session.userEmail = user.email;

    res.redirect(redirectTo);
    return;
  } catch (error) {
    console.error("Login error:", error);
    handleAuthError(
      res,
      "login",
      req.body.origin === "home",
      "Server error",
      req.body.email,
      getSafeRedirectPath(req.body.redirectTo),
    );
  }
});

router.post("/logout", (req: Request, res: Response): void => {
  req.session.destroy((err) => {
    if (err) {
      console.error("Logout error:", err);
      renderLogin(res, {
        title: "Login",
        error: "Logout failed",
      });
      return;
    }

    res.clearCookie("connect.sid");
    res.redirect("/auth/login");
  });
});

export default router;
