import express from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';

const app = express();
const server = createServer(app);
const io = new SocketIOServer(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true,
    allowedHeaders: ["my-custom-header"],
  },
  allowEIO3: true
});

// Game constants
const GAME_WIDTH = 800;
const GAME_HEIGHT = 400;
const PADDLE_WIDTH = 10;
const PADDLE_HEIGHT = 80;
const BALL_SIZE = 10;
const PADDLE_SPEED = 5;
const BALL_SPEED = 4;
const WINNING_SCORE = 6;

interface Player {
  id: string;
  paddleY: number;
  score: number;
  side: 'left' | 'right';
  ready: boolean;
}

interface Ball {
  x: number;
  y: number;
  velocityX: number;
  velocityY: number;
}

interface GameRoom {
  id: string;
  players: Map<string, Player>;
  ball: Ball;
  gameActive: boolean;
  gameStarted: boolean;
}

interface GameState {
  players: { [key: string]: Player };
  ball: Ball;
  gameActive: boolean;
  gameStarted: boolean;
}

interface GameResult {
  winner: string;
  winnerSide: 'left' | 'right';
  scores: { left: number; right: number };
}

const gameRooms = new Map<string, GameRoom>();
const waitingPlayers: string[] = [];

app.use(cors());
app.use(express.json());

function createGameRoom(player1Id: string, player2Id: string): GameRoom {
  const roomId = `room_${Date.now()}`;
  
  const room: GameRoom = {
    id: roomId,
    players: new Map([
      [player1Id, { 
        id: player1Id, 
        paddleY: GAME_HEIGHT / 2 - PADDLE_HEIGHT / 2, 
        score: 0, 
        side: 'left',
        ready: false 
      }],
      [player2Id, { 
        id: player2Id, 
        paddleY: GAME_HEIGHT / 2 - PADDLE_HEIGHT / 2, 
        score: 0, 
        side: 'right',
        ready: false 
      }]
    ]),
    ball: {
      x: GAME_WIDTH / 2,
      y: GAME_HEIGHT / 2,
      velocityX: Math.random() > 0.5 ? BALL_SPEED : -BALL_SPEED,
      velocityY: (Math.random() - 0.5) * BALL_SPEED
    },
    gameActive: false,
    gameStarted: false
  };
  
  gameRooms.set(roomId, room);
  return room;
}

// Update the updateBall function with proper null checks
function updateBall(room: GameRoom): GameResult | null {
  const { ball, players } = room;
  
  ball.x += ball.velocityX;
  ball.y += ball.velocityY;
  
  if (ball.y <= 0 || ball.y >= GAME_HEIGHT - BALL_SIZE) {
    ball.velocityY = -ball.velocityY;
    ball.y = Math.max(0, Math.min(GAME_HEIGHT - BALL_SIZE, ball.y));
  }
  
  const leftPlayer = Array.from(players.values()).find(p => p.side === 'left');
  const rightPlayer = Array.from(players.values()).find(p => p.side === 'right');
  
  // Left paddle collision with null check
  if (leftPlayer && ball.x <= PADDLE_WIDTH && 
      ball.y + BALL_SIZE >= leftPlayer.paddleY && 
      ball.y <= leftPlayer.paddleY + PADDLE_HEIGHT) {
    ball.velocityX = Math.abs(ball.velocityX);
    ball.x = PADDLE_WIDTH;
    const hitPosition = (ball.y + BALL_SIZE / 2 - leftPlayer.paddleY) / PADDLE_HEIGHT;
    ball.velocityY = (hitPosition - 0.5) * BALL_SPEED * 1.5;
  }
  
  // Right paddle collision with null check
  if (rightPlayer && ball.x + BALL_SIZE >= GAME_WIDTH - PADDLE_WIDTH && 
      ball.y + BALL_SIZE >= rightPlayer.paddleY && 
      ball.y <= rightPlayer.paddleY + PADDLE_HEIGHT) {
    ball.velocityX = -Math.abs(ball.velocityX);
    ball.x = GAME_WIDTH - PADDLE_WIDTH - BALL_SIZE;
    const hitPosition = (ball.y + BALL_SIZE / 2 - rightPlayer.paddleY) / PADDLE_HEIGHT;
    ball.velocityY = (hitPosition - 0.5) * BALL_SPEED * 1.5;
  }
  
  // Scoring with proper null checks
  if (ball.x <= 0) {
    if (!rightPlayer) return null;
    rightPlayer.score++;
    resetBall(room);
    if (rightPlayer.score >= WINNING_SCORE) {
      return {
        winner: rightPlayer.id,
        winnerSide: 'right',
        scores: {
          left: leftPlayer?.score || 0,
          right: rightPlayer.score
        }
      };
    }
  } else if (ball.x >= GAME_WIDTH) {
    if (!leftPlayer) return null;
    leftPlayer.score++;
    resetBall(room);
    if (leftPlayer.score >= WINNING_SCORE) {
      return {
        winner: leftPlayer.id,
        winnerSide: 'left',
        scores: {
          left: leftPlayer.score,
          right: rightPlayer?.score || 0
        }
      };
    }
  }
  return null;
}

function resetBall(room: GameRoom): void {
  room.ball.x = GAME_WIDTH / 2;
  room.ball.y = GAME_HEIGHT / 2;
  room.ball.velocityX = Math.random() > 0.5 ? BALL_SPEED : -BALL_SPEED;
  room.ball.velocityY = (Math.random() - 0.5) * BALL_SPEED;
}

function getGameState(room: GameRoom): GameState {
  const playersObj: { [key: string]: Player } = {};
  room.players.forEach((player, id) => {
    playersObj[id] = player;
  });
  
  return {
    players: playersObj,
    ball: room.ball,
    gameActive: room.gameActive,
    gameStarted: room.gameStarted
  };
}

function findRoomByPlayer(playerId: string): GameRoom | undefined {
  for (const room of gameRooms.values()) {
    if (room.players.has(playerId)) {
      return room;
    }
  }
  return undefined;
}

function checkAllPlayersReady(room: GameRoom): boolean {
  return Array.from(room.players.values()).every(player => player.ready);
}

io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);
  socket.request.headers.cookie = `io=${socket.id}`;
  
  waitingPlayers.push(socket.id);
  console.log(`Current waiting players: ${waitingPlayers.length}`);
  
  const matchInterval = setInterval(() => {
    if (waitingPlayers.length >= 2) {
      const player1Id = waitingPlayers.shift()!;
      const player2Id = waitingPlayers.shift()!;
      
      const player1Socket = io.sockets.sockets.get(player1Id);
      const player2Socket = io.sockets.sockets.get(player2Id);
      
      if (player1Socket && player2Socket) {
        const room = createGameRoom(player1Id, player2Id);
        
        player1Socket.join(room.id);
        player2Socket.join(room.id);
        
        const gameState = getGameState(room);
        
        player1Socket.emit('gameStart', { 
          roomId: room.id, 
          playerSide: 'left',
          gameState
        });
        
        player2Socket.emit('gameStart', { 
          roomId: room.id, 
          playerSide: 'right',
          gameState
        });
        
        console.log(`Game started: ${player1Id} vs ${player2Id} in room ${room.id}`);
      }
    }
  }, 1000);
  
  socket.on('playerReady', () => {
    const room = findRoomByPlayer(socket.id);
    if (!room) return;
    
    const player = room.players.get(socket.id);
    if (player) {
      player.ready = true;
      io.to(room.id).emit('gameUpdate', getGameState(room));
      
      if (checkAllPlayersReady(room)) {
        room.gameActive = true;
        room.gameStarted = true;
        io.to(room.id).emit('gameStarted');
      }
    }
  });
  
  socket.on('paddleMove', (data: { direction: 'up' | 'down' }) => {
    const room = findRoomByPlayer(socket.id);
    if (!room || !room.gameActive) return;
    
    const player = room.players.get(socket.id);
    if (!player) return;
    
    if (data.direction === 'up') {
      player.paddleY = Math.max(0, player.paddleY - PADDLE_SPEED);
    } else {
      player.paddleY = Math.min(GAME_HEIGHT - PADDLE_HEIGHT, player.paddleY + PADDLE_SPEED);
    }
    
    io.to(room.id).emit('gameUpdate', getGameState(room));
  });
  
  socket.on('disconnect', () => {
    clearInterval(matchInterval);
    console.log('Player disconnected:', socket.id);
    
    const waitingIndex = waitingPlayers.indexOf(socket.id);
    if (waitingIndex > -1) {
      waitingPlayers.splice(waitingIndex, 1);
    }
    
    const room = findRoomByPlayer(socket.id);
    if (room) {
      room.gameActive = false;
      io.to(room.id).emit('playerDisconnected', { 
        message: 'Opponent disconnected',
        winner: null
      });
      gameRooms.delete(room.id);
    }
  });
});

setInterval(() => {
  gameRooms.forEach((room) => {
    if (room.gameActive && room.gameStarted && room.players.size === 2) {
      const result = updateBall(room);
      if (result) {
        room.gameActive = false;
        room.gameStarted = false;
        io.to(room.id).emit('gameOver', result);
        gameRooms.delete(room.id);
      } else {
        io.to(room.id).emit('gameUpdate', getGameState(room));
      }
    }
  });
}, 1000 / 60);

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Pong server running on port ${PORT}`);
});