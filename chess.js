// ─── Constants ────────────────────────────────────────────────────────────────

// Both sides use the filled glyph set; color is handled purely by CSS
const PIECE_SYMBOLS = {
  white: { pawn: '♟', knight: '♞', bishop: '♝', rook: '♜', queen: '♛', king: '♚' },
  black: { pawn: '♟', knight: '♞', bishop: '♝', rook: '♜', queen: '♛', king: '♚' },
};

const PROMOTION_CHAIN = ['pawn', 'knight', 'bishop', 'rook', 'queen'];

const PIECE_NAMES = {
  pawn: 'Pawn', knight: 'Knight', bishop: 'Bishop',
  rook: 'Rook', queen: 'Queen', king: 'King',
};

// ─── Game State ───────────────────────────────────────────────────────────────

let board = [];           // 8×8 array; board[row][col]; row 0 = rank 8 (black's back rank)
let currentTurn = 'white';
let selectedSquare = null; // { row, col } | null
let legalMoves = [];       // array of { row, col, enPassant?: true }
let enPassantTarget = null; // { row, col } | null — the square a pawn can capture into
let lastMove = null;        // { from, to } for highlighting
let capturedByWhite = [];   // pieces captured by white
let capturedByBlack = [];
let promotionLog = [];      // { color, from, to, piece } events

// ─── Board Initialization ─────────────────────────────────────────────────────

function createPiece(type, color) {
  return { type, color, kills: 0 };
}

function initBoard() {
  board = Array.from({ length: 8 }, () => Array(8).fill(null));

  // Black back rank (row 0): all pawns except king on e-file (col 4)
  for (let col = 0; col < 8; col++) {
    board[0][col] = createPiece(col === 4 ? 'king' : 'pawn', 'black');
  }
  // Black pawn rank (row 1)
  for (let col = 0; col < 8; col++) {
    board[1][col] = createPiece('pawn', 'black');
  }

  // White pawn rank (row 6, rank 2)
  for (let col = 0; col < 8; col++) {
    board[6][col] = createPiece('pawn', 'white');
  }
  // White back rank (row 7, rank 1): all pawns except king on e-file (col 4)
  for (let col = 0; col < 8; col++) {
    board[7][col] = createPiece(col === 4 ? 'king' : 'pawn', 'white');
  }
}

// ─── Coordinate helpers ───────────────────────────────────────────────────────

function inBounds(row, col) {
  return row >= 0 && row < 8 && col >= 0 && col < 8;
}

// ─── Raw Move Generation (no legality check) ──────────────────────────────────

/**
 * Returns pseudo-legal moves for a piece at (row, col).
 * Each move is { row, col, enPassant?: true }.
 * Does NOT filter for leaving own king in check.
 */
function pseudoMoves(row, col, boardState, epTarget) {
  const piece = boardState[row][col];
  if (!piece) return [];
  const moves = [];
  const { type, color } = piece;
  const dir = color === 'white' ? -1 : 1; // white moves up (decreasing row), black down

  if (type === 'pawn') {
    // Forward 1
    const r1 = row + dir;
    if (inBounds(r1, col) && !boardState[r1][col]) {
      moves.push({ row: r1, col });
      // Forward 2 only from natural starting rank
      const startRank = color === 'white' ? 6 : 1;
      const r2 = row + 2 * dir;
      if (row === startRank && inBounds(r2, col) && !boardState[r2][col]) {
        moves.push({ row: r2, col });
      }
    }
    // Diagonal captures
    for (const dc of [-1, 1]) {
      const rc = row + dir;
      const cc = col + dc;
      if (!inBounds(rc, cc)) continue;
      const target = boardState[rc][cc];
      if (target && target.color !== color) {
        moves.push({ row: rc, col: cc });
      } else if (
        epTarget &&
        epTarget.row === rc &&
        epTarget.col === cc
      ) {
        moves.push({ row: rc, col: cc, enPassant: true });
      }
    }
    return moves;
  }

  if (type === 'knight') {
    const jumps = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
    for (const [dr, dc] of jumps) {
      const r = row + dr, c = col + dc;
      if (!inBounds(r, c)) continue;
      const t = boardState[r][c];
      if (!t || t.color !== color) moves.push({ row: r, col: c });
    }
    return moves;
  }

  if (type === 'bishop') {
    for (const [dr, dc] of [[-1,-1],[-1,1],[1,-1],[1,1]]) {
      let r = row + dr, c = col + dc;
      while (inBounds(r, c)) {
        const t = boardState[r][c];
        if (t) { if (t.color !== color) moves.push({ row: r, col: c }); break; }
        moves.push({ row: r, col: c });
        r += dr; c += dc;
      }
    }
    return moves;
  }

  if (type === 'rook') {
    for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
      let r = row + dr, c = col + dc;
      while (inBounds(r, c)) {
        const t = boardState[r][c];
        if (t) { if (t.color !== color) moves.push({ row: r, col: c }); break; }
        moves.push({ row: r, col: c });
        r += dr; c += dc;
      }
    }
    return moves;
  }

  if (type === 'queen') {
    const dirs = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
    for (const [dr, dc] of dirs) {
      let r = row + dr, c = col + dc;
      while (inBounds(r, c)) {
        const t = boardState[r][c];
        if (t) { if (t.color !== color) moves.push({ row: r, col: c }); break; }
        moves.push({ row: r, col: c });
        r += dr; c += dc;
      }
    }
    return moves;
  }

  if (type === 'king') {
    const dirs = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
    for (const [dr, dc] of dirs) {
      const r = row + dr, c = col + dc;
      if (!inBounds(r, c)) continue;
      const t = boardState[r][c];
      if (!t || t.color !== color) moves.push({ row: r, col: c });
    }
    return moves;
  }

  return moves;
}

// ─── Check Detection ──────────────────────────────────────────────────────────

/**
 * Returns true if `color`'s king is under attack on the given boardState.
 */
function isInCheck(color, boardState, epTarget) {
  const king = findKingOnBoard(color, boardState);
  if (!king) return false;
  const opponent = color === 'white' ? 'black' : 'white';
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = boardState[r][c];
      if (!p || p.color !== opponent) continue;
      const attacks = pseudoMoves(r, c, boardState, epTarget);
      if (attacks.some(m => m.row === king.row && m.col === king.col)) return true;
    }
  }
  return false;
}

function findKingOnBoard(color, boardState) {
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = boardState[r][c];
      if (p && p.type === 'king' && p.color === color) return { row: r, col: c };
    }
  }
  return null;
}

/**
 * Deep-clone the board (pieces are plain objects so JSON is fine).
 */
function cloneBoard(boardState) {
  return boardState.map(row => row.map(p => p ? { ...p } : null));
}

/**
 * Apply a move on a cloned board without side effects (used for legality testing).
 * Returns the new board.
 */
function applyMoveToBoard(fromRow, fromCol, toRow, toCol, boardState, epTarget, isEP) {
  const b = cloneBoard(boardState);
  const piece = b[fromRow][fromCol];
  b[toRow][toCol] = piece;
  b[fromRow][fromCol] = null;
  // Remove en-passant captured pawn
  if (isEP && epTarget) {
    const capturedPawnRow = fromRow; // same row as the moving pawn
    b[capturedPawnRow][toCol] = null;
  }
  return b;
}

// ─── Legal Move Generation ────────────────────────────────────────────────────

/**
 * Returns fully legal moves for the piece at (row, col) on the live board.
 */
function legalMovesFor(row, col) {
  const piece = board[row][col];
  if (!piece) return [];
  const pseudo = pseudoMoves(row, col, board, enPassantTarget);
  return pseudo.filter(move => {
    const testBoard = applyMoveToBoard(
      row, col, move.row, move.col, board, enPassantTarget, move.enPassant
    );
    return !isInCheck(piece.color, testBoard, null);
  });
}

/**
 * Does the given color have any legal moves?
 */
function hasLegalMoves(color) {
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (!p || p.color !== color) continue;
      if (legalMovesFor(r, c).length > 0) return true;
    }
  }
  return false;
}

// ─── Promotion Logic ──────────────────────────────────────────────────────────

function promoteChain(piece) {
  const idx = PROMOTION_CHAIN.indexOf(piece.type);
  if (idx === -1 || idx === PROMOTION_CHAIN.length - 1) return null; // already queen or king
  return PROMOTION_CHAIN[idx + 1];
}

// ─── Executing a Move ─────────────────────────────────────────────────────────

function executeMove(fromRow, fromCol, toRow, toCol, move) {
  const piece = board[fromRow][fromCol];
  const captured = move.enPassant ? board[fromRow][toCol] : board[toRow][toCol];

  // Move piece
  board[toRow][toCol] = piece;
  board[fromRow][fromCol] = null;

  // Remove en-passant captured pawn
  if (move.enPassant) {
    board[fromRow][toCol] = null;
  }

  // Update en-passant target for next turn
  const wasTwoStep =
    piece.type === 'pawn' &&
    Math.abs(toRow - fromRow) === 2;

  enPassantTarget = wasTwoStep
    ? { row: (fromRow + toRow) / 2, col: toCol }
    : null;

  // Record last move
  lastMove = { from: { row: fromRow, col: fromCol }, to: { row: toRow, col: toCol } };

  // Handle capture + kill-based promotion
  if (captured) {
    if (piece.color === 'white') capturedByWhite.push(captured);
    else capturedByBlack.push(captured);

    piece.kills += 1;
    const nextType = promoteChain(piece);
    if (nextType) {
      const oldType = piece.type;
      piece.type = nextType;
      piece.kills = 0;
      promotionLog.push({
        color: piece.color,
        square: `${String.fromCharCode(97 + toCol)}${8 - toRow}`,
        from: oldType,
        to: nextType,
      });
    }
  }

  // Switch turn
  currentTurn = currentTurn === 'white' ? 'black' : 'white';
  selectedSquare = null;
  legalMoves = [];
}

// ─── Rendering ────────────────────────────────────────────────────────────────

function render() {
  renderBoard();
  renderSidePanels();
  renderStatus();
}

function renderBoard() {
  const boardEl = document.getElementById('board');
  boardEl.innerHTML = '';

  // Squares where the king is in check
  const whiteCheck = isInCheck('white', board, enPassantTarget);
  const blackCheck = isInCheck('black', board, enPassantTarget);
  const kingInCheckPos = new Set();
  if (whiteCheck) {
    const k = findKingOnBoard('white', board);
    if (k) kingInCheckPos.add(`${k.row},${k.col}`);
  }
  if (blackCheck) {
    const k = findKingOnBoard('black', board);
    if (k) kingInCheckPos.add(`${k.row},${k.col}`);
  }

  // Build sets for quick lookup
  const legalSet = new Set(legalMoves.map(m => `${m.row},${m.col}`));
  const captureSet = new Set(
    legalMoves
      .filter(m => (board[m.row][m.col] && board[m.row][m.col].color !== currentTurn) || m.enPassant)
      .map(m => `${m.row},${m.col}`)
  );

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const sq = document.createElement('div');
      const isLight = (r + c) % 2 === 0;
      sq.classList.add('square', isLight ? 'light' : 'dark');
      sq.dataset.row = r;
      sq.dataset.col = c;

      const key = `${r},${c}`;

      // Last-move highlight (behind check highlight)
      if (
        lastMove &&
        (
          (lastMove.from.row === r && lastMove.from.col === c) ||
          (lastMove.to.row === r && lastMove.to.col === c)
        )
      ) {
        sq.classList.add('last-move');
      }

      if (selectedSquare && selectedSquare.row === r && selectedSquare.col === c) {
        sq.classList.add('selected');
      }

      if (kingInCheckPos.has(key)) {
        sq.classList.add('in-check');
      }

      if (legalSet.has(key)) {
        sq.classList.add(captureSet.has(key) ? 'legal-capture' : 'legal-move');
      }

      const piece = board[r][c];
      if (piece) {
        const pieceEl = document.createElement('span');
        pieceEl.classList.add('piece', `${piece.color}-piece`);
        pieceEl.textContent = PIECE_SYMBOLS[piece.color][piece.type];
        sq.appendChild(pieceEl);

        // Kill badge — show kills counter if > 0 (piece working toward next promotion)
        if (piece.kills > 0) {
          const badge = document.createElement('span');
          badge.classList.add('kill-badge');
          badge.textContent = piece.kills;
          sq.appendChild(badge);
        }
      }

      sq.addEventListener('click', onSquareClick);
      boardEl.appendChild(sq);
    }
  }
}

function renderSidePanels() {
  // Captured pieces
  document.getElementById('captured-by-white').textContent =
    capturedByWhite.map(p => PIECE_SYMBOLS[p.color][p.type]).join('');
  document.getElementById('captured-by-black').textContent =
    capturedByBlack.map(p => PIECE_SYMBOLS[p.color][p.type]).join('');

  // Promotion logs
  renderPromotionLog('white');
  renderPromotionLog('black');
}

function renderPromotionLog(color) {
  const el = document.getElementById(`promotion-log-${color}`);
  const entries = promotionLog.filter(e => e.color === color);
  el.innerHTML = entries
    .map(e => `<div class="promo-event">${e.square}: ${PIECE_NAMES[e.from]} → ${PIECE_NAMES[e.to]}</div>`)
    .join('');
  el.scrollTop = el.scrollHeight;
}

function renderStatus() {
  const turnEl = document.getElementById('turn-indicator');
  const checkEl = document.getElementById('check-indicator');

  turnEl.textContent = currentTurn === 'white' ? "White's Turn" : "Black's Turn";

  const inCheck = isInCheck(currentTurn, board, enPassantTarget);
  checkEl.classList.toggle('hidden', !inCheck);
}

// ─── Game Over ────────────────────────────────────────────────────────────────

function checkGameOver() {
  const opponent = currentTurn; // just switched, so current player must move
  const inCheck = isInCheck(opponent, board, enPassantTarget);
  const noMoves = !hasLegalMoves(opponent);

  if (noMoves) {
    if (inCheck) {
      showOverlay(
        'Checkmate!',
        `${opponent === 'white' ? 'Black' : 'White'} wins by checkmate.`
      );
    } else {
      showOverlay('Stalemate!', 'The game is a draw by stalemate.');
    }
  }
}

function showOverlay(title, message) {
  document.getElementById('overlay-title').textContent = title;
  document.getElementById('overlay-message').textContent = message;
  document.getElementById('overlay').classList.remove('hidden');
}

// ─── UI Interaction ───────────────────────────────────────────────────────────

function onSquareClick(e) {
  const sq = e.currentTarget;
  const row = parseInt(sq.dataset.row, 10);
  const col = parseInt(sq.dataset.col, 10);
  const piece = board[row][col];

  // If a move destination is clicked
  if (selectedSquare) {
    const move = legalMoves.find(m => m.row === row && m.col === col);
    if (move) {
      executeMove(selectedSquare.row, selectedSquare.col, row, col, move);
      render();
      checkGameOver();
      return;
    }
    // Clicking own piece selects it instead
    if (piece && piece.color === currentTurn) {
      selectedSquare = { row, col };
      legalMoves = legalMovesFor(row, col);
      render();
      return;
    }
    // Clicking empty/opponent square with no legal move → deselect
    selectedSquare = null;
    legalMoves = [];
    render();
    return;
  }

  // No selection yet — select a piece
  if (piece && piece.color === currentTurn) {
    selectedSquare = { row, col };
    legalMoves = legalMovesFor(row, col);
    render();
  }
}

// ─── Restart ──────────────────────────────────────────────────────────────────

function restartGame() {
  currentTurn = 'white';
  selectedSquare = null;
  legalMoves = [];
  enPassantTarget = null;
  lastMove = null;
  capturedByWhite = [];
  capturedByBlack = [];
  promotionLog = [];
  initBoard();
  document.getElementById('overlay').classList.add('hidden');
  render();
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────

document.getElementById('restart-btn').addEventListener('click', restartGame);

initBoard();
render();

