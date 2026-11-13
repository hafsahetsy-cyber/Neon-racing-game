import { Game } from './core/Game';

async function boot() {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const ui = document.getElementById('ui') as HTMLElement;
  const loading = document.getElementById('loading') as HTMLElement;
  const game = new Game(canvas, ui);
  // Dev handle: lets tests and the console drive the game (e.g. __game.input.override = { throttle: 1 }).
  (window as unknown as { __game: Game }).__game = game;
  try {
    await game.init();
    game.start();
    loading.classList.add('done');
  } catch (err) {
    console.error(err);
    document.getElementById('loading-text')!.textContent = 'FAILED TO START — SEE CONSOLE';
  }
}

boot();
