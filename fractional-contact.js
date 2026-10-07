/* Public intake only. No dashboard, API or authentication writes. */
(() => {
  'use strict';
  const requested = new URLSearchParams(location.search).get('tipo');
  const kind = requested === 'socio' ? 'socio' : 'startup';
  document.querySelectorAll('[data-application-panel]').forEach(panel => {
    panel.hidden = panel.dataset.applicationPanel !== kind;
  });
  document.querySelectorAll('[data-select-application]').forEach(link => {
    if (link.dataset.selectApplication === kind) link.setAttribute('aria-current', 'page');
  });
  document.querySelectorAll('input[type="number"]').forEach(input => {
    input.min = '0'; input.max = input.name === 'socio_horas' ? '240' : '60'; input.step = '1';
  });
  document.querySelectorAll('form[data-application]').forEach(form => {
    const review = form.querySelector('[data-review]');
    // A changed field invalidates the previous draft, so stale details cannot be sent.
    form.addEventListener('input', event => {
      if (!review.contains(event.target)) review.hidden = true;
    });
    form.addEventListener('submit', event => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      const subject = form.dataset.application === 'socio'
        ? 'ROIS TRADE | Postulación a Socio de Dirección Comercial'
        : 'ROIS TRADE | Evaluación de startup para Dirección Comercial Fractional';
      const lines = [...form.querySelectorAll('[data-label]')].map(input => `${input.dataset.label}: ${input.value.trim() || 'No indicado'}`);
      const body = `${subject}\n\n${lines.join('\n')}\n\nHe leído el aviso de privacidad y solicito contacto para evaluar mi solicitud.`;
      review.querySelector('textarea').value = body;
      review.querySelector('[data-mail]').href = `mailto:contacto@roistrade.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      review.querySelector('[data-copy-status]').textContent = '';
      review.hidden = false;
      review.focus();
    });
    form.querySelector('[data-copy]').addEventListener('click', async () => {
      const text = review.querySelector('textarea');
      try {
        await navigator.clipboard.writeText(text.value);
        review.querySelector('[data-copy-status]').textContent = 'Texto copiado. Pégalo en un correo a contacto@roistrade.com y envíalo.';
      } catch {
        text.focus(); text.select();
        review.querySelector('[data-copy-status]').textContent = 'Seleccionamos el texto. Cópialo y envíalo a contacto@roistrade.com desde tu correo.';
      }
    });
  });
})();
