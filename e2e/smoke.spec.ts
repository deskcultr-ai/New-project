import { test, expect } from "@playwright/test";

test("login page renders the sign-in form", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  await expect(page.getByPlaceholder("you@company.com")).toBeVisible();
});

test("visiting a protected page while signed out redirects to /login", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
});

test("the org request page renders", async ({ page }) => {
  await page.goto("/request-org");
  await expect(page.getByRole("heading", { name: "Request an organization" })).toBeVisible();
});
