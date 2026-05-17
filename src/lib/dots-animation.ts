// Canvas 2D port of the original PixiJS injectDotsBackground from temp-rccf-repo.
// Appends a position:fixed transparent canvas to document.body so mouse coords
// match exactly. Returns a cleanup function to destroy everything.
export function injectDotsBackground(n: number = 80): () => void {
	const canvas = document.createElement('canvas');
	const ctx = canvas.getContext('2d')!;
	const dpr = Math.min(window.devicePixelRatio ?? 1, 2);

	Object.assign(canvas.style, {
		position: 'fixed',
		inset: '0',
		width: '100%',
		height: '100%',
		zIndex: '-10',
		pointerEvents: 'none'
	});
	document.body.appendChild(canvas);

	let width = 0;
	let height = 0;

	type Ball = {
		x: number;
		y: number;
		r: number;
		vx: number;
		vy: number;
		seed: number;
		gold: boolean;
	};
	const balls: Ball[] = new Array(n);

	function spawn() {
		for (let i = 0; i < n; i++) {
			const angle = Math.random() * Math.PI * 2;
			const speed = (Math.random() * 8) / 50;
			balls[i] = {
				x: Math.random() * width,
				y: Math.random() * height,
				r: 0.5 + Math.random() * 1.5,
				vx: Math.cos(angle) * speed,
				vy: Math.sin(angle) * speed,
				seed: Math.random() * n,
				gold: false
			};
		}
	}

	function resize() {
		width = window.innerWidth;
		height = window.innerHeight;
		canvas.width = Math.round(width * dpr);
		canvas.height = Math.round(height * dpr);
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		spawn();
	}

	const mouse = { x: -999, y: -999, down: false };
	let k = 0;
	let rafId = 0;
	let running = false;

	function draw() {
		if (!running) return;
		rafId = requestAnimationFrame(draw);
		k += 1 / 30000;

		ctx.clearRect(0, 0, width, height);

		for (let i = 0; i < n; i++) {
			const b = balls[i];

			b.x += b.vx;
			b.y += b.vy;

			if (b.x < 0) {
				b.x = 0;
				b.vx = Math.abs(b.vx);
			} else if (b.x > width) {
				b.x = width;
				b.vx = -Math.abs(b.vx);
			}
			if (b.y < 0) {
				b.y = 0;
				b.vy = Math.abs(b.vy);
			} else if (b.y > height) {
				b.y = height;
				b.vy = -Math.abs(b.vy);
			}

			const dx = mouse.x - b.x;
			const dy = mouse.y - b.y;
			const dist = Math.sqrt(dx * dx + dy * dy);

			if (dist < 70) {
				b.gold = true;
				const t = 1 - dist / 70;
				ctx.strokeStyle = `rgba(175,175,54,${t * 0.7})`;
				ctx.lineWidth = t * 1.5;
				ctx.beginPath();
				ctx.moveTo(b.x, b.y);
				ctx.lineTo(mouse.x, mouse.y);
				ctx.stroke();
				if (mouse.down) {
					b.x += dx * 0.015;
					b.y += dy * 0.015;
				}
			} else {
				b.gold = false;
			}

			const alpha = (1 / 3) * Math.cos(k + b.seed) + 2 / 3;
			ctx.fillStyle = b.gold ? `rgba(175,175,54,${alpha})` : `rgba(242,242,242,${alpha * 0.55})`;
			ctx.beginPath();
			ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
			ctx.fill();
		}

		// Cursor ring
		ctx.strokeStyle = 'rgba(175,175,54,0.35)';
		ctx.lineWidth = 1.5;
		ctx.beginPath();
		ctx.arc(mouse.x, mouse.y, 20, 0, Math.PI * 2);
		ctx.stroke();
	}

	const onMove = (e: MouseEvent) => {
		mouse.x = e.clientX;
		mouse.y = e.clientY;
	};
	const onDown = () => {
		mouse.down = true;
	};
	const onUp = () => {
		mouse.down = false;
	};
	const onResize = () => resize();
	const onVis = () => {
		if (document.hidden) {
			running = false;
			cancelAnimationFrame(rafId);
		} else {
			running = true;
			rafId = requestAnimationFrame(draw);
		}
	};

	window.addEventListener('mousemove', onMove);
	window.addEventListener('mousedown', onDown);
	window.addEventListener('mouseup', onUp);
	window.addEventListener('resize', onResize);
	document.addEventListener('visibilitychange', onVis);

	resize();
	running = true;
	rafId = requestAnimationFrame(draw);

	return () => {
		running = false;
		cancelAnimationFrame(rafId);
		window.removeEventListener('mousemove', onMove);
		window.removeEventListener('mousedown', onDown);
		window.removeEventListener('mouseup', onUp);
		window.removeEventListener('resize', onResize);
		document.removeEventListener('visibilitychange', onVis);
		canvas.remove();
	};
}
