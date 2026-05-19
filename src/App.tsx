import React, { useEffect, useRef, useState } from 'react';
import { Volume2, VolumeX } from 'lucide-react';

// --- GAME CONSTANTS ---
const ACCELERATION = 0.08;
const FRICTION = 0.85;
const CAR_WIDTH = 40;
const CAR_HEIGHT = 70;
const OBSTACLE_WIDTH = 40;
const OBSTACLE_HEIGHT = 70;
const NEON_CYAN = '#22d3ee';
const DARK_BG = '#020617'; // slate-950
const ROAD_BG = '#0f172a'; // slate-900

// Standardized game area width for calculation consistency despite screen width
const GAME_WIDTH = 800; 

interface GameObject {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Car extends GameObject {
  vx: number;
}

interface Obstacle extends GameObject {
  speed: number;
  color: string;
}

class AudioController {
  private ctx: AudioContext | null = null;
  public muted = false;

  init() {
    if (this.muted) return;
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
  }

  playCrash() {
    if (this.muted || !this.ctx) return;
    
    // Resume context if suspended (common browser policy)
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    
    // Deep, descending saw tone for crash
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(150, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(10, this.ctx.currentTime + 0.6);
    
    gain.gain.setValueAtTime(0.3, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.6);
    
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    
    osc.start();
    osc.stop(this.ctx.currentTime + 0.6);
  }
}

const sfx = new AudioController();

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isMuted, setIsMuted] = useState(false);
  
  // HUD refs to bypass React render cycle for performance
  const distElRef = useRef<HTMLSpanElement>(null);
  const speedElRef = useRef<HTMLSpanElement>(null);
  const crashElRef = useRef<HTMLDivElement>(null);

  const toggleMute = () => {
    const newState = !isMuted;
    setIsMuted(newState);
    sfx.muted = newState;
    if (!newState) sfx.init();
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width = window.innerWidth;
    let height = window.innerHeight;

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      // High DPI screens
      const dpr = window.devicePixelRatio || 1;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.scale(dpr, dpr);
    };

    window.addEventListener('resize', resize);
    resize();

    // --- GAME STATE ---
    let targetX = width / 2;
    let isCrashed = false;
    let crashTimer = 0;

    let distance = 0;
    let baseSpeed = 5;
    const maxBaseSpeed = 20;

    let linesOffset = 0;

    const player: Car = {
      x: width / 2,
      y: height - 120, // fixed near bottom
      width: CAR_WIDTH,
      height: CAR_HEIGHT,
      vx: 0
    };

    let obstacles: Obstacle[] = [];

    // --- CONTROLS ---
    const handleMove = (x: number) => {
      // Initialize audio context on first user interaction if not muted
      sfx.init();
      targetX = x;
    };

    const onPointerMove = (e: PointerEvent) => handleMove(e.clientX);
    window.addEventListener('pointermove', onPointerMove);

    // --- CORE LOOP ---
    let frameId: number;
    let lastTime = performance.now();

    const spawnObstacle = () => {
      // Center the road area dynamically
      const roadMaxWidth = Math.min(width, GAME_WIDTH);
      const roadLeft = (width - roadMaxWidth) / 2;
      
      const padding = OBSTACLE_WIDTH;
      // Random x within the road boundaries
      const x = roadLeft + padding + Math.random() * (roadMaxWidth - padding * 2);
      
      obstacles.push({
        x,
        y: -OBSTACLE_HEIGHT, // start above screen
        width: OBSTACLE_WIDTH,
        height: OBSTACLE_HEIGHT,
        speed: baseSpeed * (0.5 + Math.random() * 0.8), // varied speeds, some slower, some faster
        color: Math.random() > 0.5 ? '#334155' : '#1e293b'
      });
    };

    let spawnTimer = 0;

    const checkCollision = (r1: GameObject, r2: GameObject) => {
      // Make hitboxes slightly smaller than graphics for forgiveness
      const shrink = 10;
      return (
        r1.x - r1.width/2 + shrink < r2.x + r2.width/2 - shrink &&
        r1.x + r1.width/2 - shrink > r2.x - r2.width/2 + shrink &&
        r1.y - r1.height/2 + shrink < r2.y + r2.height/2 - shrink &&
        r1.y + r1.height/2 - shrink > r2.y - r2.height/2 + shrink
      );
    };

    const update = (dt: number) => {
      if (isCrashed) {
        crashTimer -= dt;
        if (crashTimer <= 0) {
          isCrashed = false;
          baseSpeed = 5;
          obstacles = []; // clear obstacles
          if (crashElRef.current) crashElRef.current.style.opacity = '0';
        }
        return; // Pause game logic while crashed
      }

      // Physics
      const roadMaxWidth = Math.min(width, GAME_WIDTH);
      const roadLeft = (width - roadMaxWidth) / 2;
      const roadRight = roadLeft + roadMaxWidth;

      // Bound target to road
      let boundedTargetX = targetX;
      if (boundedTargetX < roadLeft + CAR_WIDTH/2) boundedTargetX = roadLeft + CAR_WIDTH/2;
      if (boundedTargetX > roadRight - CAR_WIDTH/2) boundedTargetX = roadRight - CAR_WIDTH/2;

      // Fluid movement
      player.vx += (boundedTargetX - player.x) * ACCELERATION;
      player.vx *= FRICTION;
      player.x += player.vx;

      // Ensure player stays perfectly inside bounds despite friction/overshoot
      if (player.x < roadLeft + CAR_WIDTH/2) {
        player.x = roadLeft + CAR_WIDTH/2;
        player.vx = 0;
      }
      if (player.x > roadRight - CAR_WIDTH/2) {
        player.x = roadRight - CAR_WIDTH/2;
        player.vx = 0;
      }

      // Keep Y tied to screen height
      player.y = height - 120;

      // Progression
      distance += baseSpeed * (dt / 16.6); // normalized to 60fps
      if (baseSpeed < maxBaseSpeed) {
        baseSpeed += 0.002 * (dt / 16.6); 
      }

      linesOffset = (linesOffset + baseSpeed) % 100;

      // Obstacles
      spawnTimer -= dt;
      if (spawnTimer <= 0) {
        spawnObstacle();
        // Faster base speed = faster spawn rate
        spawnTimer = 800 + Math.random() * 800 - (baseSpeed * 20); 
        if (spawnTimer < 400) spawnTimer = 400; // clamp min spawn time
      }

      for (let i = obstacles.length - 1; i >= 0; i--) {
        const obs = obstacles[i];
        
        // Relative speed: if obs speed is less than baseSpeed (player speed), it comes towards player.
        // It's conceptually easier if everything moves downwards based on its speed + base speed to simulate driving past them.
        obs.y += obs.speed * (dt / 16.6);

        // Check collision
        if (checkCollision(player, obs)) {
          isCrashed = true;
          crashTimer = 1500; // 1.5 second penalty
          sfx.playCrash();
          if (crashElRef.current) crashElRef.current.style.opacity = '1';
          break;
        }

        // Cleanup
        if (obs.y > height + obs.height) {
          obstacles.splice(i, 1);
        }
      }
    };

    const drawGrid = () => {
      ctx.save();
      
      const roadMaxWidth = Math.min(width, GAME_WIDTH);
      const roadLeft = (width - roadMaxWidth) / 2;
      const roadRight = roadLeft + roadMaxWidth;

      // Fill background
      ctx.fillStyle = DARK_BG;
      ctx.fillRect(0, 0, width, height);

      // Fill road
      ctx.fillStyle = ROAD_BG;
      ctx.fillRect(roadLeft, 0, roadMaxWidth, height);

      // Neon road borders
      ctx.strokeStyle = 'rgba(34,211,238,0.5)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(roadLeft, 0);
      ctx.lineTo(roadLeft, height);
      ctx.moveTo(roadRight, 0);
      ctx.lineTo(roadRight, height);
      ctx.stroke();

      // Moving dashed center lanes
      ctx.strokeStyle = 'rgba(34,211,238,0.2)';
      ctx.lineWidth = 2;
      ctx.setLineDash([40, 20]);
      ctx.lineDashOffset = -linesOffset;

      const numLanes = 3;
      const laneWidth = roadMaxWidth / numLanes;

      for (let i = 1; i < numLanes; i++) {
        const x = roadLeft + i * laneWidth;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }

      ctx.restore();
    };

    const drawCar = () => {
      ctx.save();
      ctx.translate(player.x, player.y);
      
      // Rotate slightly based on velocity
      const maxTilt = 0.3; // radians
      let tilt = player.vx * 0.015;
      if (tilt > maxTilt) tilt = maxTilt;
      if (tilt < -maxTilt) tilt = -maxTilt;
      ctx.rotate(tilt);

      if (isCrashed) {
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 3;
        ctx.shadowColor = '#ef4444';
        ctx.shadowBlur = 25;
        ctx.beginPath();
        ctx.roundRect(-CAR_WIDTH/2 + (Math.random()*4-2), -CAR_HEIGHT/2 + (Math.random()*4-2), CAR_WIDTH, CAR_HEIGHT, 8);
        ctx.stroke();
      } else {
        // Theme Car
        ctx.shadowBlur = 15;
        ctx.shadowColor = '#22d3ee';
        ctx.fillStyle = '#22d3ee';
        ctx.beginPath();
        ctx.roundRect(-CAR_WIDTH/2, -CAR_HEIGHT/2, CAR_WIDTH, CAR_HEIGHT, 8);
        ctx.fill();
        ctx.fillStyle = '#0891b2';
        ctx.shadowBlur = 0;
        ctx.fillRect(-CAR_WIDTH/2+5, -CAR_HEIGHT/2+10, CAR_WIDTH-10, 15);
      }

      ctx.restore();
    };

    const drawObstacles = () => {
      ctx.save();
      obstacles.forEach(obs => {
        ctx.fillStyle = obs.color;
        
        ctx.translate(obs.x, obs.y);
        ctx.beginPath();
        ctx.roundRect(-obs.width/2, -obs.height/2, obs.width, obs.height, 4);
        ctx.fill();
        
        ctx.strokeStyle = 'rgba(255,255,255,0.1)';
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.translate(-obs.x, -obs.y);
      });
      ctx.restore();
    };

    const drawHUD = () => {
      // Update DOM nodes directly for performance (bypassing React)
      if (distElRef.current) {
        distElRef.current.innerText = Math.floor(distance / 10).toString().padStart(6, '0');
      }
      if (speedElRef.current) {
        const speedKph = Math.floor((baseSpeed / 5) * 100);
        speedElRef.current.innerText = isCrashed ? '0' : speedKph.toString();
      }
    };

    const loop = (time: number) => {
      const dt = time - lastTime;
      lastTime = time;

      // Cap delta time to prevent giant jumps when tab is inactive
      if (dt < 100) {
        update(dt);
        drawGrid();
        drawObstacles();
        drawCar();
        drawHUD();
      }

      frameId = requestAnimationFrame(loop);
    };

    frameId = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', onPointerMove);
    };
  }, []);

  return (
    <div className="relative w-full h-screen overflow-hidden bg-slate-950 font-sans touch-none select-none">
      
      {/* Game Canvas */}
      <canvas 
        ref={canvasRef} 
        className="absolute inset-0 block w-full h-full"
        style={{ cursor: 'none' }} // hide cursor over canvas for better immersion
      />

      <div className="absolute top-8 right-8 z-20">
        <button 
          onClick={toggleMute} 
          className="pointer-events-auto glass-ui px-6 py-2 rounded-full text-xs font-semibold tracking-widest text-slate-400 hover:text-cyan-400 transition-colors uppercase flex items-center gap-2"
          aria-label="Toggle Sound"
        >
          {isMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
          {isMuted ? 'Audio: Off' : 'Audio: On'}
        </button>
      </div>

      <div className="absolute bottom-12 w-full flex justify-center gap-24 z-20 pointer-events-none">
        <div className="flex flex-col items-center">
          <span className="text-[10px] uppercase tracking-widest text-slate-500 mb-1">Current Speed</span>
          <span ref={speedElRef} className="text-4xl font-light text-slate-100 neon-text tabular-nums">0</span>
          <span className="text-[10px] text-cyan-500/50 mt-1">KM/H</span>
        </div>

        <div className="flex flex-col items-center">
           <span className="text-[10px] uppercase tracking-widest text-slate-500 mb-1">Distance Travelled</span>
           <span ref={distElRef} className="text-4xl font-light text-slate-100 neon-text tabular-nums">0</span>
           <span className="text-[10px] text-cyan-500/50 mt-1">METERS</span>
        </div>
      </div>

      <div ref={crashElRef} className="absolute inset-0 bg-slate-950/80 flex items-center justify-center z-30 opacity-0 pointer-events-none transition-opacity duration-300">
        <div className="text-center">
          <h2 className="text-6xl font-extralight tracking-tighter text-cyan-400 mb-4">System Reset</h2>
          <p className="text-slate-400 uppercase tracking-widest text-xs">Collision Detected / Recalibrating...</p>
        </div>
      </div>

    </div>
  );
}
