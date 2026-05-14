(function () {
  const header = document.querySelector(".site-header");
  const button = document.querySelector(".site-menu-button");

  if (!header || !button) return;

  button.addEventListener("click", () => {
    const isOpen = header.classList.toggle("site-nav-open");
    button.setAttribute("aria-expanded", String(isOpen));
    button.setAttribute("aria-label", isOpen ? "Close menu" : "Open menu");
  });
})();
