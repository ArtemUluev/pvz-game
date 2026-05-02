const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static('public'));

const ROWS = 5, COLS = 9;
const FIELD_START_X = 150, CELL_W = 85, CELL_H = 90, FIELD_TOP_Y = 120;
const FIELD_END_X = FIELD_START_X + COLS * CELL_W;

const PLANT_STATS = {
  sunflower: { cost: 50, hp: 80, sunInterval: 10, cooldown: 10 },
  peashooter: { cost: 100, hp: 80, damage: 25, shootInterval: 1.5, cooldown: 2 },
  snowpea: { cost: 175, hp: 80, damage: 20, shootInterval: 1.7, slow: true, cooldown: 3 },
  walnut: { cost: 50, hp: 600, cooldown: 8 },
  cherrybomb: { cost: 150, hp: 1, explosive: true, cooldown: 15 }
};

const ZOMBIE_STATS = {
  basic: { hp: 100, speed: 28, damage: 25, reward: 25, cost: 30 },
  cone: { hp: 200, speed: 22, damage: 25, reward: 40, cost: 50 },
  bucket: { hp: 400, speed: 18, damage: 35, reward: 60, cost: 80 },
  runner: { hp: 80, speed: 50, damage: 15, reward: 30, cost: 40 },
  gargantuar: { hp: 1000, speed: 14, damage: 1000, reward: 150, cost: 150 }
};

let players = { defender: null, attacker: null };

let game = {
  plants: [],
  zombies: [],
  projectiles: [],
  sunDrops: [],
  lawnmowers: Array(ROWS).fill(true),
  sunPoints: 150,
  zombieEnergy: 60,
  maxEnergy: 300,
  prepTimer: 15,
  elapsedTime: 0,
  spawnLocked: true,
  plantCooldowns: {},
  score1: 0,
  score2: 0,
  gameOver: false,
  winner: null,
  hordeTimer: 120,
  lastUpdate: Date.now()
};

function resetRound() {
  game.plants = [];
  game.zombies = [];
  game.projectiles = [];
  game.sunDrops = [];
  game.lawnmowers = Array(ROWS).fill(true);
  game.sunPoints = 150;
  game.zombieEnergy = 60;
  game.prepTimer = 15;
  game.elapsedTime = 0;
  game.spawnLocked = true;
  game.plantCooldowns = {};
  game.score1 = 0;
  game.score2 = 0;
  game.gameOver = false;
  game.winner = null;
  game.hordeTimer = 120;
  game.lastUpdate = Date.now();
}

function update() {
  const now = Date.now();
  const dt = Math.min(0.2, (now - game.lastUpdate) / 1000);
  game.lastUpdate = now;

  if (game.spawnLocked) {
    game.prepTimer -= dt;
    if (game.prepTimer <= 0) game.spawnLocked = false;
    return;
  }

  game.elapsedTime += dt;
  game.zombieEnergy = Math.min(game.maxEnergy, game.zombieEnergy + 5 * dt);

  // Авто-орда
  if (game.elapsedTime > 30) {
    game.hordeTimer -= dt;
    if (game.hordeTimer <= 0) {
      const count = 5 + Math.floor(game.elapsedTime / 20);
      for (let i = 0; i < count; i++) {
        const types = ['basic', 'cone', 'bucket'];
        const type = types[Math.floor(Math.random() * types.length)];
        const row = Math.floor(Math.random() * ROWS);
        const stats = ZOMBIE_STATS[type];
        if (stats && game.zombieEnergy >= stats.cost) {
          game.zombieEnergy -= stats.cost;
          game.zombies.push({
            type, row,
            x: FIELD_END_X,
            y: FIELD_TOP_Y + row * CELL_H + CELL_H / 2,
            hp: stats.hp, maxHp: stats.hp, speed: stats.speed,
            damage: stats.damage, reward: stats.reward, alive: true, slowed: false
          });
        }
      }
      game.hordeTimer = 90 + Math.random() * 60;
    }
  }

  // кулдауны растений
  Object.keys(game.plantCooldowns).forEach(k => {
    game.plantCooldowns[k] = Math.max(0, game.plantCooldowns[k] - dt);
  });

  // Растения
  game.plants.forEach(p => {
    if (!p.alive) return;
    const s = PLANT_STATS[p.type];
    if (!s) return;
    p.shootTimer -= dt;

    if (s.sunInterval) {
      p.sunTimer -= dt;
      if (p.sunTimer <= 0) {
        game.sunDrops.push({
          x: p.x + (Math.random() - 0.5) * 40,
          y: p.y - 10,
          alive: true
        });
        p.sunTimer = s.sunInterval + Math.random() * 4;
      }
    }

    if (s.damage && p.shootTimer <= 0) {
      if (game.zombies.some(z => z.row === p.row && z.alive && z.x > p.x)) {
        game.projectiles.push({
          x: p.x + 20,
          y: p.y,
          row: p.row,
          damage: s.damage,
          slow: s.slow || false,
          alive: true
        });
        p.shootTimer = s.shootInterval;
      }
    }

    if (s.explosive && p.plantTime && now - p.plantTime > 600) {
      game.zombies.forEach(z => {
        if (z.alive && Math.hypot(z.x - p.x, z.y - p.y) < 160) z.hp -= 180;
      });
      p.alive = false;
    }

    if (p.hp <= 0) p.alive = false;
  });

  // Зомби
  game.zombies.forEach(z => {
    if (!z.alive) return;

    const block = game.plants.find(p => p.alive && p.row === z.row && Math.abs(z.x - p.x) < 45);
    if (block) {
      z.attackTimer -= dt;
      if (z.attackTimer <= 0) {
        if (z.type === 'gargantuar') {
          block.hp = 0;
        } else {
          block.hp -= z.damage;
        }
        z.attackTimer = 0.7;
        if (block.hp <= 0) {
          block.alive = false;
          game.zombieEnergy = Math.min(game.maxEnergy, game.zombieEnergy + 20);
        }
      }
    } else {
      z.x -= z.speed * dt;
    }

    // Газонокосилка
    if (z.x < FIELD_START_X && game.lawnmowers[z.row]) {
      game.lawnmowers[z.row] = false;
      game.zombies.forEach(zz => { if (zz.row === z.row) zz.alive = false; });
    }

    // Дом
    if (z.x < FIELD_START_X - 60 && !game.lawnmowers[z.row]) {
      z.alive = false;
      game.score2++;
      if (game.score2 >= 5) {
        game.gameOver = true;
        game.winner = 'attacker';
      }
    }

    if (z.hp <= 0) {
      z.alive = false;
      game.score1++;
      game.sunPoints += z.reward;
      game.zombieEnergy = Math.min(game.maxEnergy, game.zombieEnergy + 10);
    }
  });

  // Снаряды
  game.projectiles.forEach(p => {
    if (!p.alive) return;
    p.x += 400 * dt;
    game.zombies.forEach(z => {
      if (!z.alive || z.row !== p.row) return;
      if (Math.abs(p.x - z.x) < 22) {
        z.hp -= p.damage;
        if (p.slow) z.slowed = true;
        p.alive = false;
      }
    });
    if (p.x > FIELD_END_X + 100) p.alive = false;
  });

  // Случайное солнце
  if (Math.random() < dt * 0.1) {
    game.sunDrops.push({
      x: FIELD_START_X + Math.random() * COLS * CELL_W,
      y: 90,
      alive: true
    });
  }

  game.plants = game.plants.filter(p => p.alive);
  game.zombies = game.zombies.filter(z => z.alive);
  game.projectiles = game.projectiles.filter(p => p.alive);
  game.sunDrops = game.sunDrops.filter(s => s.alive);
}

setInterval(() => {
  update();
  io.emit('state', {
    plants: game.plants.filter(p => p.alive).map(p => ({
      type: p.type, row: p.row, col: p.col, x: p.x, y: p.y, hp: p.hp
    })),
    zombies: game.zombies.filter(z => z.alive).map(z => ({
      type: z.type, row: z.row, x: z.x, y: z.y, hp: z.hp, slowed: z.slowed
    })),
    projectiles: game.projectiles.filter(p => p.alive).map(p => ({
      x: p.x, y: p.y, row: p.row
    })),
    sunDrops: game.sunDrops.filter(s => s.alive).map((s, i) => ({
      id: i, x: s.x, y: s.y
    })),
    lawnmowers: game.lawnmowers,
    sunPoints: Math.floor(game.sunPoints),
    zombieEnergy: Math.floor(game.zombieEnergy),
    spawnLocked: game.spawnLocked,
    prepTimer: Math.ceil(game.prepTimer),
    elapsedTime: game.elapsedTime,
    plantCooldowns: game.plantCooldowns,
    score1: game.score1,
    score2: game.score2,
    gameOver: game.gameOver,
    winner: game.winner,
    hordeTimer: Math.ceil(game.hordeTimer)
  });
}, 1000 / 30);

io.on('connection', socket => {
  if (!players.defender) {
    players.defender = socket.id;
    socket.emit('role', 'defender');
  } else if (!players.attacker) {
    players.attacker = socket.id;
    socket.emit('role', 'attacker');
    resetRound();
  } else {
    socket.emit('error', 'Полно');
    socket.disconnect();
    return;
  }

  socket.on('plant', data => {
    if (socket.id !== players.defender || game.gameOver || game.spawnLocked) return;
    const s = PLANT_STATS[data.type];
    if (!s || game.sunPoints < s.cost || (game.plantCooldowns[data.type] || 0) > 0) return;
    if (game.plants.some(p => p.alive && p.row === data.row && p.col === data.col)) return;
    game.sunPoints -= s.cost;
    game.plantCooldowns[data.type] = s.cooldown || 3;
    game.plants.push({
      type: data.type, row: data.row, col: data.col,
      x: FIELD_START_X + data.col * CELL_W + CELL_W / 2,
      y: FIELD_TOP_Y + data.row * CELL_H + CELL_H / 2,
      hp: s.hp, maxHp: s.hp,
      shootTimer: 0, sunTimer: 0,
      plantTime: Date.now(), alive: true
    });
  });

  socket.on('collect', data => {
    if (socket.id !== players.defender) return;
    const s = game.sunDrops[data.id];
    if (s?.alive) {
      game.sunPoints += 25;
      s.alive = false;
    }
  });

  socket.on('shovel', data => {
    if (socket.id !== players.defender || game.gameOver || game.spawnLocked) return;
    const plant = game.plants.find(p => p.alive && p.row === data.row && p.col === data.col);
    if (plant) {
      const s = PLANT_STATS[plant.type];
      if (s) {
        game.sunPoints += Math.floor(s.cost * 0.5);
        plant.alive = false;
      }
    }
  });

  socket.on('zombie', data => {
    if (socket.id !== players.attacker || game.gameOver || game.spawnLocked) return;
    const s = ZOMBIE_STATS[data.type];
    if (!s || game.zombieEnergy < s.cost) return;
    game.zombieEnergy -= s.cost;
    game.zombies.push({
      type: data.type,
      row: data.row,
      x: FIELD_END_X,
      y: FIELD_TOP_Y + data.row * CELL_H + CELL_H / 2,
      hp: s.hp, maxHp: s.hp, speed: s.speed,
      damage: s.damage, reward: s.reward, alive: true, slowed: false
    });
  });

  socket.on('disconnect', () => {
    if (socket.id === players.defender) players.defender = null;
    if (socket.id === players.attacker) players.attacker = null;
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('v3.2 порт ' + PORT));
