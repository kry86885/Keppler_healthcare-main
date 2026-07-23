import "./styles.css";

const appUrl = import.meta.env.VITE_APP_URL || "http://localhost:5173";

const loginForm = document.querySelector("#login-form");
const registerForm = document.querySelector("#register-form");

if (loginForm) {
  loginForm.addEventListener("submit", (event) => {
    event.preventDefault();
    window.location.href = appUrl;
  });
}

if (registerForm) {
  registerForm.addEventListener("submit", (event) => {
    event.preventDefault();
    window.location.href = appUrl;
  });
}

document.querySelectorAll("[data-app-link]").forEach((element) => {
  element.href = appUrl;
});

document.querySelectorAll("[data-app-url-text]").forEach((element) => {
  element.textContent = appUrl;
});
