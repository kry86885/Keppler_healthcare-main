import "./styles.css";

const appUrl = import.meta.env.VITE_APP_URL || "http://localhost:5173";

document.querySelectorAll("[data-app-link]").forEach((element) => {
  const link = element;
  link.href = appUrl;
});

document.querySelectorAll("[data-app-url-text]").forEach((element) => {
  element.textContent = appUrl;
});

const navPairs = Array.from(document.querySelectorAll("[data-nav-toggle]")).map((toggle) => {
  const key = toggle.getAttribute("data-nav-toggle");
  const panel = document.querySelector(`[data-nav-panel="${key}"]`);
  return { toggle, panel };
});
const siteHeader = document.querySelector("[data-site-header]");
const heroSection = document.querySelector("[data-hero-section]");

if (siteHeader && heroSection) {
  const syncHeaderState = () => {
    const heroBottom = heroSection.offsetTop + heroSection.offsetHeight;
    const isVisible = window.scrollY >= heroBottom - 96;
    siteHeader.classList.toggle("is-visible", isVisible);

    if (!isVisible) {
      navPairs.forEach(({ toggle, panel }) => {
        if (panel) panel.classList.add("hidden");
        toggle.setAttribute("aria-expanded", "false");
      });
    }
  };

  syncHeaderState();
  window.addEventListener("scroll", syncHeaderState, { passive: true });
  window.addEventListener("resize", syncHeaderState);
}

navPairs.forEach(({ toggle, panel }) => {
  if (toggle && panel) {
    toggle.addEventListener("click", () => {
      panel.classList.toggle("hidden");
      const expanded = toggle.getAttribute("aria-expanded") === "true";
      toggle.setAttribute("aria-expanded", String(!expanded));
    });

    panel.querySelectorAll("a").forEach((link) => {
      link.addEventListener("click", () => {
        panel.classList.add("hidden");
        toggle.setAttribute("aria-expanded", "false");
      });
    });
  }
});

const animatedNodes = document.querySelectorAll("[data-animate]");

if ("IntersectionObserver" in window && animatedNodes.length > 0) {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const node = entry.target;
          const delay = Number(node.getAttribute("data-delay") || "0");
          window.setTimeout(() => {
            node.classList.add("in-view");
          }, delay);
          observer.unobserve(node);
        }
      });
    },
    { threshold: 0.15 }
  );

  animatedNodes.forEach((node) => {
    node.classList.add("animate-fade-up");
    observer.observe(node);
  });
}
