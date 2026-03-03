// Global tooltip handler for [data-tooltip] elements
(function() {
    const el = document.createElement('div');
    el.id = 'tooltip-global';
    document.body.appendChild(el);

    let current = null;

    document.addEventListener('mouseover', function(e) {
        const target = e.target.closest('[data-tooltip]');
        if (!target) return;
        current = target;
        el.textContent = target.getAttribute('data-tooltip');
        el.style.opacity = '1';
        positionTooltip(target);
    });

    document.addEventListener('mouseout', function(e) {
        const target = e.target.closest('[data-tooltip]');
        if (target && target === current) {
            el.style.opacity = '0';
            current = null;
        }
    });

    function positionTooltip(target) {
        const rect = target.getBoundingClientRect();
        const pos = target.getAttribute('data-tooltip-pos') || 'top';
        // Make visible off-screen to measure
        el.style.left = '-9999px';
        el.style.top = '-9999px';
        el.style.opacity = '0';
        el.style.display = 'block';

        requestAnimationFrame(function() {
            const ttRect = el.getBoundingClientRect();
            let left, top;

            if (pos === 'bottom') {
                left = rect.left + rect.width / 2 - ttRect.width / 2;
                top = rect.bottom + 8;
            } else if (pos === 'left') {
                left = rect.left - ttRect.width - 8;
                top = rect.top + rect.height / 2 - ttRect.height / 2;
            } else {
                // top (default)
                left = rect.left + rect.width / 2 - ttRect.width / 2;
                top = rect.top - ttRect.height - 8;
            }

            // Clamp to viewport
            if (left < 4) left = 4;
            if (left + ttRect.width > window.innerWidth - 4) left = window.innerWidth - ttRect.width - 4;
            if (top < 4) top = 4;
            if (top + ttRect.height > window.innerHeight - 4) top = window.innerHeight - ttRect.height - 4;

            el.style.left = left + 'px';
            el.style.top = top + 'px';
            if (current === target) {
                el.style.opacity = '1';
            }
        });
    }
})();
