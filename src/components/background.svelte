<script lang="ts">
	import * as PIXI from 'pixi.js';
	import { onMount } from 'svelte';
	import { distance, polkaDot, Vector2 } from './piximaths';
	export const Density = 20;
	export const Size = 2;
	export const HoverMultiplier = 3;
	export const Color = 0xf2f2f2;

	onMount(() => {
		const app = new PIXI.Application({
			antialias: true,
			backgroundColor: 0x0a0908,
			backgroundAlpha: 1,
			width: document.getElementById('application')?.clientWidth,
			height: document.getElementById('application')?.clientHeight
		});
		//@ts-ignore
		document.getElementById('application').appendChild(app.view); // this works, ts just doesnt like it
		const mousePos = new Vector2(app.renderer.width / 2, app.renderer.height / 2);
		document.addEventListener('mousemove', (e) => {
			mousePos.update(e.clientX, e.clientY - 75 + window.scrollY);
			updatDrawings();
		});

		//create all polka dots and assign them an ID
		//@ts-ignore
		const polkaDots = [new polkaDot()];
		const DrawDots = () => {
			const horizontalCount = Math.round(app.renderer.width * (Density / 100));
			const verticalCount = Math.round(app.renderer.height * (Density / 100));
			const horizontalSpacing = Math.round(app.renderer.width / horizontalCount);
			const verticalSpacing = Math.round(app.renderer.height / verticalCount);
			for (let i = 0; i < horizontalCount; i += horizontalSpacing + Size) {
				for (let j = 0; j < Math.floor(verticalCount); j += verticalSpacing + Size) {
					if (j % 2) {
						polkaDots.push(new polkaDot(i * horizontalSpacing, j * verticalSpacing, Size, Color));
					} else {
						polkaDots.push(
							new polkaDot(
								i * horizontalSpacing + horizontalSpacing * 3.5,
								j * verticalSpacing,
								Size,
								Color
							)
						);
					}
				}
			}
			//@ts-ignore
			polkaDots.forEach((p) => {
				p.draw();
				app.stage.addChild(p.polka_gr);
			});
			console.log(horizontalCount, horizontalSpacing, verticalCount, verticalSpacing);
		};
		DrawDots();

		const updatDrawings = () => {
			// @ts-ignore
			for (let i = 0; i < polkaDots.length; i++) {
				const distanceP = distance(mousePos, polkaDots[i].getPositionVect2());
				if (distanceP < 100) {
					polkaDots[i].r = Math.max(Size, (Size * 100) / distanceP);
					polkaDots[i].r = Math.min(polkaDots[i].r, Size * HoverMultiplier);
				} else {
					polkaDots[i].r = Size;
				}

				polkaDots[i].draw();
			}
		};
	});
</script>

<div id="application" class="background-pixi" />

<style>
	.background-pixi {
        position: fixed;
        width: 100%;
        height: 100%;
	}
</style>
