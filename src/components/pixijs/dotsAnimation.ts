import * as PIXI from 'pixi.js';

class Vector {
  angle: number | undefined;
  magnitude: number | undefined;
  xMagnitude: number;
  yMagnitude: number;
  constructor(angle: number | undefined, magnitude: number | undefined) {
    this.angle = angle;
    this.magnitude = magnitude;
    this.xMagnitude = magnitude! * Math.cos(angle!);
    this.yMagnitude = magnitude! * Math.sin(angle! * -1);
  }
}

class ballInfo {
  r: any;
  x: any;
  y: any;
  vector: any;
  color: any;
  seed: any;
  constructor(r: number, x: number, y: number, vector: Vector, color: number, seed: number) {
    this.r = r;
    this.x = x;
    this.y = y;
    this.vector = vector;
    this.color = color;
    this.seed = seed;
  }
  //updates the vector component with a new magnitude
  updateMagnitude(mag: number | undefined) {
    this.vector = new Vector(this.vector.angle, mag);
  }
}
class Mouse {
  x: any;
  y: any;
  down: any;
  up: any;
  lastClickedPos: Point;
  constructor(x: number, y: number, down: boolean, up: boolean, lcp = new Point(0, 0)) {
    this.x = x;
    this.y = y;
    this.down = down;
    this.up = up;
    this.lastClickedPos = lcp;
  }
  /**
   * Sets the last clicked position automatically to the cursor's current position
   */
  click() {
    this.lastClickedPos = new Point(this.x, this.y);
  }
}
class Point {
  x: number;
  y: number;

  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
  Set(a: number) {
    this.x = a;
    this.y = a;
  }
}
export function injectDots(ele: Element, n: number = 200) {
  let app = new PIXI.Application({
    width: 768,
    height: 768,
    antialias: true,
    backgroundColor: 0x151515
  });
  const num_balls = n;
  // init ball vars
  let r = 5; // the radius of the ball
  let width = app.renderer.width,
    height = app.renderer.height - r * 2; // the width and height of the app with safe space for the balls
  let min_x = r,
    max_x = width - r * 2;
  let min_y = r,
    max_y = height - r;

  app.stage.hitArea = app.screen;
  app.stage.interactive = true;
  let vect = new Vector(0, 0);
  let mousePos = new Mouse(0, 0, false, true);
  app.stage.on('mousemove', function (e) {
    mousePos.x = e.data.global.x;
    mousePos.y = e.data.global.y;
  });
  var balls = new Array(num_balls);
  window.onresize = function () {
    resize_handler();
  };
  resize_handler();

  function resize_handler() {
    app.renderer.resize(window.innerWidth, window.innerHeight);
    width = app.renderer.width;
    height = app.renderer.height;
    max_y = height - r;
    max_x = width - r;
    GenerateBallData();
  }
  GenerateBallData();

  function GenerateBallData() {
    for (let i = 0; i < balls.length; i++) {
      var _r = 0.5 + Math.random() * 1.5;
      let tmp_vect = new Vector(rad(Math.random() * 360), (Math.random() * 8) / 50); // all math is in radians
      balls[i] = new ballInfo(
        _r,
        Math.floor(Math.random() * max_x),
        Math.floor(Math.max(Math.random() * max_y, min_y)),
        tmp_vect,
        0xf2f2f2,
        Math.random() * num_balls
      );
    }
  }

  let graphics = new PIXI.Graphics();
  let line = new PIXI.Graphics();
  let glowgrafx = new PIXI.Graphics();
  var k = 0;

  let cursorRadius = 70;
  let linecolor = 0xf2f2f2;

  function CursorHandler(delta: number) {
    //draw the cursor art
    graphics.lineStyle(1.5, 0xafaf36);
    graphics.drawCircle(mousePos.x, mousePos.y, 20);
    graphics.endFill();
    //detect if the ball is within the radius of the cursor

    balls.forEach((ball) => {
      if (distancetocursor(ball.x, ball.y) < cursorRadius) {
        ball.color = 0xafaf36;
        Glow(ball.x, ball.y, 0xafaf36, 4, 3, true);
        line.position = new PIXI.Point(0, 0);
        line.lineStyle(1 / map(distancetocursor(ball.x, ball.y), 0, 70, 0.2, 3), linecolor);
        line.moveTo(ball.x, ball.y);
        line.lineTo(mousePos.x, mousePos.y);
        if (mousePos.down) {
          Glow(mousePos.x, mousePos.y, 0xafaf36, 2, 5, true);
          linecolor = 0xafaf36;
          ball.x = lerp(ball.x, mousePos.x, delta / 100);
          ball.y = lerp(ball.y, mousePos.y, delta / 100);
        } else {
          Glow(mousePos.x, mousePos.y, 0x4a4a4a, 2, 5, true);
          linecolor = 0xf2f2f2;
        }
      } else {
        ball.color = 0xf2f2f2;
      }
    });
    if (distancetocursor(buttonsCenter.x, buttonsCenter.y) > 130) {
      CursorButtons.clear();
      isSpawnCircle = false;
    }
  }
  app.stage.on('mousedown', function (e) {
    mousePos.down = true;
    mousePos.up = false;
    mousePos.click();
    if (
      isSpawnCircle &&
      40 < distancetocursor(buttonsCenter.x, buttonsCenter.y) &&
      distancetocursor(buttonsCenter.x, buttonsCenter.y) < 100
    ) {
      for (let i = 0; i < num_balls; i++) {
        if (distance(buttonsCenter.x, balls[i].x, buttonsCenter.y, balls[i].y) < 100) {
          balls[i].updateMagnitude(10);
        }
      }
    }
    ClickHandler();
  }); //mouse is currently down, and on the canvas
  app.stage.on('mouseup', function (e) {
    mousePos.down = false;
    mousePos.up = true;
  }); // mouse has let go
  let num_clicks = 0;
  let px: number, py: number;
  let cx: number, cy: number;

  let buttonsCenter = new Point(mousePos.x, mousePos.y);

  function ClickHandler() {
    //
    num_clicks++;
    py = cy;
    px = cx;
    cx = Math.floor(mousePos.x);
    cy = Math.floor(mousePos.y);
    if (num_clicks == 2 && cx == px && cy == py) {
      num_clicks = 0;
      buttonsCenter = new Point(mousePos.x, mousePos.y);
      DoubleClickHandler();
    } else if (num_clicks > 2) {
      num_clicks = 0;
    }
  }
  let CursorButtons = new PIXI.Graphics();

  let isSpawnCircle = false;

  function DoubleClickHandler() {
    // fires whenever the user double clicks on the page
    isSpawnCircle = true;
    CursorButtons.clear();
    CursorButtons.lineStyle(1, 0xafaf36);
    //generate the "exit this circle to cancel" circle
    CursorButtons.drawCircle(mousePos.x, mousePos.y, 130);

    DrawButtonOptions();

    function DrawButtonOptions() {
      /*
        be able to draw x buttons
        button 0 should have a plane icon
            the plane will pull all the balls on screen to the button,
            as the button fills until ~90%
            once this is complete, the "plane" spawns; follows, and circles the cursor
        */
      var N = 3; // number of buttons to spawn

      var degPerButton = 360 / N;
      for (let i = 0; i < N; i++) {
        var start = i * degPerButton;
        DrawButton(start, start + degPerButton);
      }

      function DrawButton(sa: number, ea: number) {
        CursorButtons.lineStyle(1, 0xf2f2f2);
        CursorButtons.arc(mousePos.x, mousePos.y, 100, rad(sa), rad(ea), true); // outer
        CursorButtons.endFill();
        CursorButtons.arc(mousePos.x, mousePos.y, 40, rad(sa), rad(ea), true); // inner
        CursorButtons.endFill();
      }
    }

    app.stage.addChild(CursorButtons);
  }

  function BallPhysics(delta: number) {
    for (let i = 0; i < num_balls; i++) {
      // init multiple balls
      //handle collisions with the walls and such
      if (deg(balls[i].vector.angle) < 0) {
        balls[i].vector = new Vector(
          rad(deg(balls[i].vector.angle) + 360),
          balls[i].vector.magnitude
        );
      }

      if (balls[i].x > max_x + 2 * r) {
        // right wall
        if (deg(balls[i].vector.angle) > 0 && deg(balls[i].vector.angle) < 90) {
          balls[i].vector = new Vector(
            rad(180 - Math.abs(deg(balls[i].vector.angle) + 360)),
            balls[i].vector.magnitude
          );
        } else if (deg(balls[i].vector.angle) > 270 && deg(balls[i].vector.angle) < 360) {
          balls[i].vector = new Vector(
            rad(180 + Math.abs(deg(balls[i].vector.angle) - 360)),
            balls[i].vector.magnitude
          );
        }
      } else if (balls[i].x < r * -2) {
        // left wall
        //balls[i].color = 0xA6763C;
        if (deg(balls[i].vector.angle) > 90 && deg(balls[i].vector.angle) < 180) {
          balls[i].vector = new Vector(
            rad(180 - Math.abs(deg(balls[i].vector.angle) + 360)),
            balls[i].vector.magnitude
          );
        } else if (deg(balls[i].vector.angle) > 180 && deg(balls[i].vector.angle) < 270) {
          balls[i].vector = new Vector(
            rad(180 + Math.abs(deg(balls[i].vector.angle) - 360)),
            balls[i].vector.magnitude
          );
        }
      } else if (balls[i].y > max_y + 4 * r) {
        // floor
        //balls[i].color = 0x0D0D0D;
        if (deg(balls[i].vector.angle) > 270 && deg(balls[i].vector.angle) < 360) {
          balls[i].vector = new Vector(
            rad(Math.abs(deg(balls[i].vector.angle) - 360)),
            balls[i].vector.magnitude
          );
        } else if (deg(balls[i].vector.angle) > 180 && deg(balls[i].vector.angle) < 270) {
          balls[i].vector = new Vector(
            rad(Math.abs(deg(balls[i].vector.angle) - 360)),
            balls[i].vector.magnitude
          );
        }
      } else if (balls[i].y < min_y) {
        // ceiling
        //balls[i].color = 0x0D0D0D;
        if (deg(balls[i].vector.angle) > 0 && deg(balls[i].vector.angle) < 90) {
          balls[i].vector = new Vector(
            rad(Math.abs(deg(balls[i].vector.angle) - 360)),
            balls[i].vector.magnitude
          );
        } else if (deg(balls[i].vector.angle) > 90 && deg(balls[i].vector.angle) < 180) {
          balls[i].vector = new Vector(
            rad(Math.abs(deg(balls[i].vector.angle) - 360)),
            balls[i].vector.magnitude
          );
        }
      }
      // apply vector magnitudes to the balls
      balls[i];

      balls[i].x += balls[i].vector.xMagnitude; //change the x depending on the vector
      balls[i].y += balls[i].vector.yMagnitude; //change the y depending on the vector
      k += delta / 30000;
      graphics.lineStyle(0);
      graphics.beginFill(balls[i].color, (1 / 3) * Math.cos(k + balls[i].seed) + 2 / 3);
      graphics.drawCircle(balls[i].x, balls[i].y, balls[i].r);
      graphics.endFill();
    }
  }
  function Glow(
    x: number,
    y: number,
    color: number | undefined,
    resolution: number,
    radius: number,
    enable: boolean
  ) {
    if (enable) {
      let step = radius / resolution;
      for (let i = 0; i < resolution; i++) {
        glowgrafx.lineStyle(0);
        glowgrafx.beginFill(color, 1 / resolution);
        glowgrafx.drawCircle(x, y, step);
        step = step + step;
      }
      app.stage.addChild(glowgrafx);
    }
  }
  function distancetocursor(x: number, y: number) {
    return Math.sqrt(Math.pow(mousePos.x - x, 2) + Math.pow(mousePos.y - y, 2));
  }
  //@ts-ignore
  ele.appendChild(app.view);
  app.ticker.add((delta) => {
    glowgrafx.clear();
    graphics.clear();
    line.clear();
    BallPhysics(delta);
    CursorHandler(delta);
    app.stage.addChild(graphics, line);
  });
}
function deg(rad: number) {
  return (rad * 180) / Math.PI;
}
function rad(deg: number) {
  return (deg * Math.PI) / 180;
}
function lerp(v0: number, v1: number, t: number) {
  return v0 * (1 - t) + v1 * t;
}
function map(x: number, in_min: number, in_max: number, out_min: number, out_max: number) {
  return ((x - in_min) * (out_max - out_min)) / (in_max - in_min) + out_min;
}
function distance(x1: number, x2: number, y1: number, y2: number) {
  return Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
}
