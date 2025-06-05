import React, { useState, useEffect, useCallback, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import './App.css';

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

const GAME_WIDTH = 800;
const GAME_HEIGHT = 400;
const PADDLE_WIDTH = 10;
const PADDLE_HEIGHT = 80;
const BALL_SIZE = 10;
const WINNING_SCORE = 6;

const MultiplayerPong: React.FC = () => {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [playerSide, setPlayerSide] = useState<'left' | 'right' | null>(null);
  const [gameStatus, setGameStatus] = useState<'waiting' | 'playing' | 'disconnected'>('waiting');
  const [roomId, setRoomId] = useState<string | null>(null);
  const [winner, setWinner] = useState<string | null>(null);
  const [winnerSide, setWinnerSide] = useState<'left' | 'right' | null>(null);
  const [playerReady, setPlayerReady] = useState(false);
  const [allPlayersReady, setAllPlayersReady] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const keysPressed = useRef<Set<string>>(new Set());

  useEffect(() => {
    const newSocket = io('http://localhost:3001', {
      forceNew: true,
      transports: ['websocket'],
      query: {
        uniqueId: Date.now().toString() + Math.random().toString(36).substring(2)
      }
    });
    
    setSocket(newSocket);

    newSocket.on('connect', () => {
      console.log('Connected to server with ID:', newSocket.id);
    });

    newSocket.on('connect_error', (err) => {
      console.error('Connection error:', err);
    });

    newSocket.on('waiting', (data) => {
      setGameStatus('waiting');
      console.log(data.message);
    });

    newSocket.on('gameStart', (data) => {
      setRoomId(data.roomId);
      setPlayerSide(data.playerSide);
      setGameState(data.gameState);
      setGameStatus('playing');
      console.log(`Game started! You are the ${data.playerSide} player`);
    });

    newSocket.on('gameUpdate', (data: GameState) => {
      setGameState(data);
      setAllPlayersReady(data.players ? 
        Object.values(data.players).every(player => player.ready) : false);
    });

    newSocket.on('gameStarted', () => {
      setGameState(prev => prev ? { ...prev, gameStarted: true } : null);
    });

    newSocket.on('gameOver', (result: GameResult) => {
      setWinner(result.winner === newSocket.id ? 'You' : 'Opponent');
      setWinnerSide(result.winnerSide);
      setGameStatus('disconnected');
    });

    newSocket.on('playerDisconnected', (data) => {
      setGameStatus('disconnected');
      setWinner(data.winner ? (data.winner === newSocket.id ? 'You' : 'Opponent') : null);
      console.log(data.message);
    });

    return () => {
      newSocket.close();
    };
  }, []);

  const handleReady = () => {
    if (socket) {
      socket.emit('playerReady');
      setPlayerReady(true);
    }
  };

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (!socket || gameStatus !== 'playing' || !gameState?.gameStarted) return;
    
    keysPressed.current.add(event.key);
    
    if (event.key === 'ArrowUp' || event.key === 'w' || event.key === 'W') {
      socket.emit('paddleMove', { direction: 'up' });
    } else if (event.key === 'ArrowDown' || event.key === 's' || event.key === 'S') {
      socket.emit('paddleMove', { direction: 'down' });
    }
  }, [socket, gameStatus, gameState?.gameStarted]);

  const handleKeyUp = useCallback((event: KeyboardEvent) => {
    keysPressed.current.delete(event.key);
  }, []);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [handleKeyDown, handleKeyUp]);

  useEffect(() => {
    if (gameStatus !== 'playing' || !socket || !gameState?.gameStarted) return;

    const interval = setInterval(() => {
      if (keysPressed.current.has('ArrowUp') || keysPressed.current.has('w') || keysPressed.current.has('W')) {
        socket.emit('paddleMove', { direction: 'up' });
      }
      if (keysPressed.current.has('ArrowDown') || keysPressed.current.has('s') || keysPressed.current.has('S')) {
        socket.emit('paddleMove', { direction: 'down' });
      }
    }, 16);

    return () => clearInterval(interval);
  }, [gameStatus, socket, gameState?.gameStarted]);

  useEffect(() => {
    if (!gameState || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(GAME_WIDTH / 2, 0);
    ctx.lineTo(GAME_WIDTH / 2, GAME_HEIGHT);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = '#fff';
    Object.values(gameState.players).forEach(player => {
      const paddleX = player.side === 'left' ? 0 : GAME_WIDTH - PADDLE_WIDTH;
      ctx.fillRect(paddleX, player.paddleY, PADDLE_WIDTH, PADDLE_HEIGHT);
    });

    ctx.fillStyle = '#fff';
    ctx.fillRect(gameState.ball.x, gameState.ball.y, BALL_SIZE, BALL_SIZE);

  }, [gameState]);

  const getScores = () => {
    if (!gameState) return { left: 0, right: 0 };
    
    const players = Object.values(gameState.players);
    const leftPlayer = players.find(p => p.side === 'left');
    const rightPlayer = players.find(p => p.side === 'right');
    
    return {
      left: leftPlayer?.score || 0,
      right: rightPlayer?.score || 0
    };
  };

  const scores = getScores();

  const connectToGame = () => {
    window.location.reload();
  };

  return (
    <div className="game-container">
      <h1 className="game-title">Multiplayer Pong</h1>
      
      {gameStatus === 'waiting' && (
        <div className="game-status">
          <div>Waiting for another player...</div>
          <div className="loading-spinner"></div>
        </div>
      )}

      {gameStatus === 'disconnected' && (
        <div className="game-status error">
          {winner ? (
            <>
              <div>Game Over! {winner} won!</div>
              <div className="final-scores">
                Final Score: {scores.left} - {scores.right}
              </div>
            </>
          ) : (
            <div>Player disconnected</div>
          )}
          <button className="game-button" onClick={connectToGame}>
            Play Again
          </button>
        </div>
      )}

      {gameStatus === 'playing' && gameState && (
        <div className="game-content">
          {!gameState.gameStarted ? (
            <div className="start-game-prompt">
              {!playerReady ? (
                <button 
                  className="game-button" 
                  onClick={handleReady}
                  disabled={playerReady}
                >
                  Ready to Play
                </button>
              ) : (
                <div className="waiting-message">
                  Waiting for opponent to be ready...
                  {allPlayersReady && <div>Starting game...</div>}
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="score-display">
                <div className={`player-score ${playerSide === 'left' ? 'left' : ''} ${winnerSide === 'left' ? 'winning' : ''}`}>
                  Player 1: {scores.left}
                </div>
                <div className={`player-score ${playerSide === 'right' ? 'right' : ''} ${winnerSide === 'right' ? 'winning' : ''}`}>
                  Player 2: {scores.right}
                </div>
              </div>

              <div className="game-canvas-container">
                <canvas
                  ref={canvasRef}
                  width={GAME_WIDTH}
                  height={GAME_HEIGHT}
                  className="game-canvas"
                />
              </div>
            </>
          )}

          <div className="controls-info">
            <div className="match-found">Match Found</div>
            <div className="controls-main">
              You are controlling the {playerSide} paddle
            </div>
            <div className="controls-sub">
              Use Arrow Keys or W/S to move your paddle
            </div>
          </div>

          <div className="game-info">
            <div>Room ID: {roomId}</div>
            <div>Status: {gameState.gameStarted ? 'Game Active' : 'Waiting to start'}</div>
            <div>First to {WINNING_SCORE} points wins!</div>
          </div>
        </div>
      )}

      <div className="instructions">
        <h2 className="instructions-title">How to Play:</h2>
        <p>This is a real-time multiplayer Pong game. You'll be automatically matched with another player.</p>
        <p>Control your paddle using the Arrow Keys (↑↓) or W/S keys to hit the ball back to your opponent.</p>
        <p>First player to score {WINNING_SCORE} points wins!</p>
      </div>
    </div>
  );
};

export default MultiplayerPong;