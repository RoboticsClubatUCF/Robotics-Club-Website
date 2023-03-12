import * as PIXI from 'pixi.js';

export class polkaDot {
	polka_gr: PIXI.Graphics;
	color: number;
	r: number;
	y: number;
	x: number;
	constructor(x: number, y: number, r: number, c: number) {
		this.x = x;
		this.y = y;
		this.r = r;
		this.color = c;
		this.polka_gr = new PIXI.Graphics();
	}
	draw() {
        this.polka_gr.clear()
		this.polka_gr.beginFill(this.color);
		this.polka_gr.drawCircle(this.x, this.y, this.r);
		this.polka_gr.endFill();

	}
	updateVals(
		x: number | undefined,
		y: number | undefined,
		r: number | undefined,
		c: number | undefined
	) {
		if (x != undefined) {
			this.x = x;
		}
		if (y != undefined) {
			this.y = y;
		}
		if (r != undefined) {
			this.r = r;
		}
		if (c != undefined) {
			this.color = c;
		}
	}
	getPositionVect2() {
		return new Vector2(this.x, this.y);
	}
}
export class Vector2 {
	x: number;
	y: number;
	constructor(x: number, y: number) {
		this.x = x;
		this.y = y;
	}
	update(x: number, y: number) {
		this.x = x;
		this.y = y;
	}
}

export function distance(d1: Vector2, d2: Vector2) {
	return Math.sqrt(Math.pow(d2.x - d1.x, 2) + Math.pow(d2.y - d1.y, 2));
}
