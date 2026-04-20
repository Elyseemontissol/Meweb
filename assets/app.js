(() => {
  // Mobile menu toggle — uses event delegation so it works even when
  // the header is injected asynchronously by shared.js
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.menu-btn');
    if (btn) {
      const header = document.querySelector('.site-header');
      if (!header) return;
      header.classList.toggle('open');
      const expanded = header.classList.contains('open');
      btn.setAttribute('aria-expanded', expanded);
      return;
    }

    // Close mobile menu when clicking a nav link
    const navLink = e.target.closest('.nav a');
    if (navLink) {
      const header = document.querySelector('.site-header');
      if (header) header.classList.remove('open');
      const menuBtn = document.querySelector('.menu-btn');
      if (menuBtn) menuBtn.setAttribute('aria-expanded', 'false');
    }
  });

  // FAQ Accordion
  const faqItems = document.querySelectorAll('.faq-item');
  faqItems.forEach(item => {
    const question = item.querySelector('.faq-question');
    if (!question) return;
    question.addEventListener('click', () => {
      const isActive = item.classList.contains('active');
      // Close all others
      faqItems.forEach(other => {
        other.classList.remove('active');
        const otherBtn = other.querySelector('.faq-question');
        if (otherBtn) otherBtn.setAttribute('aria-expanded', 'false');
      });
      // Toggle current
      if (!isActive) {
        item.classList.add('active');
        question.setAttribute('aria-expanded', 'true');
      }
    });
  });

})();
