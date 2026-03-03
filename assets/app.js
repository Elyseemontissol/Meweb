(() => {
  const header = document.querySelector('.site-header');
  const btn = document.querySelector('.menu-btn');
  if (header && btn) {
    btn.addEventListener('click', () => header.classList.toggle('open'));
  }

  /* ===== Scroll Controlled Map ===== */
  const map = document.getElementById('contactMap');
  if (!map) return;

  let lastScroll = window.scrollY;

  window.addEventListener('scroll', () => {
    const currentScroll = window.scrollY;

    if (currentScroll > lastScroll && currentScroll > 200) {
      // Scrolling DOWN
      map.classList.add('map-hidden');
    } else {
      // Scrolling UP
      map.classList.remove('map-hidden');
    }

    lastScroll = currentScroll;
  });
})();
document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('newsletterForm');
  if (!form) return;

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type="submit"]');
    const input = form.querySelector('input[type="email"]');

    if (btn) btn.textContent = 'Subscribed ✔';
    if (input) input.value = '';
  });
});
