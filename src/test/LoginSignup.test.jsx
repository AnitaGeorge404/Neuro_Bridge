import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import Login from "@/pages/Login";

const auth = vi.hoisted(() => ({
  signUpWithEmail: vi.fn(),
}));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({
    login: vi.fn(),
    loginWithEmail: vi.fn(),
    loginWithGoogle: vi.fn(),
    googleSignInAvailable: false,
    signUpWithEmail: auth.signUpWithEmail,
  }),
}));

function renderSignup() {
  render(<MemoryRouter><Login /></MemoryRouter>);
  fireEvent.click(screen.getByRole("button", { name: "Sign Up" }));
  fireEvent.change(screen.getByLabelText("Full Name"), { target: { value: "Test User" } });
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "test@example.com" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "password123" } });
  fireEvent.change(screen.getByLabelText("Confirm Password"), { target: { value: "password123" } });
  fireEvent.click(screen.getByRole("button", { name: "Create Account" }));
}

describe("signup errors", () => {
  it("shows Supabase HTTP errors instead of calling them connectivity failures", async () => {
    auth.signUpWithEmail.mockRejectedValueOnce(new Error("Email rate limit exceeded"));
    renderSignup();

    expect(await screen.findByRole("alert")).toHaveTextContent("Email rate limit exceeded");
    expect(screen.queryByText(/Cannot reach the authentication service/i)).not.toBeInTheDocument();
  });

  it("identifies a status-zero Supabase retryable error as a connectivity failure", async () => {
    const error = Object.assign(new Error("Failed to fetch"), {
      name: "AuthRetryableFetchError",
      status: 0,
    });
    auth.signUpWithEmail.mockRejectedValueOnce(error);
    renderSignup();

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Cannot reach the authentication service"));
  });
});
