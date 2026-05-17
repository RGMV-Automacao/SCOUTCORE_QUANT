export function settleTickets(db, { dryRun = false } = {}) {
  // 1. Busca tickets com status 'submitted' ou 'pending'
  const submissions = db.prepare(`
    SELECT submission_id, run_id, tickets_json, status 
    FROM yankee_submissions 
    WHERE status IN ('submitted', 'pending')
  `).all();

  const getPredictionResult = db.prepare(`
    SELECT result FROM prediction 
    WHERE run_id = ? AND match_id = ? AND market_key = ?
  `);

  const updateSubmission = dryRun ? null : db.prepare(`
    UPDATE yankee_submissions 
    SET tickets_json = ?, status = ?, settled_at = datetime('now') 
    WHERE submission_id = ?
  `);

  let settledCount = 0;
  let pendingCount = 0;
  let greenCount = 0;
  let redCount = 0;

  for (const sub of submissions) {
    let tickets;
    try {
      tickets = JSON.parse(sub.tickets_json);
    } catch (e) {
      continue;
    }

    if (!Array.isArray(tickets) || tickets.length === 0) {
      continue;
    }

    let allTicketsFinal = true;
    let allTicketsRed = true;

    for (const ticket of tickets) {
      if (ticket.status !== 'pending') {
        if (ticket.status === 'green') allTicketsRed = false;
        continue;
      }

      let ticketIsRed = false;
      let allBoardsGreen = true;
      let ticketPending = false;

      for (const board of (ticket.boards || [])) {
        if (board.status !== 'pending') {
          if (board.status === 'red') {
            ticketIsRed = true;
            allBoardsGreen = false;
          } else if (board.status !== 'green') {
            allBoardsGreen = false;
          }
          continue;
        }

        let boardIsRed = false;
        let allLegsGreen = true;
        let boardPending = false;

        for (const leg of (board.legs || [])) {
          if (leg.status !== 'pending') {
            if (leg.status === 'red') {
              boardIsRed = true;
              allLegsGreen = false;
            } else if (leg.status !== 'green') {
              allLegsGreen = false;
            }
            continue;
          }

          // Busca result na prediction
          const row = getPredictionResult.get(sub.run_id, board.match_id, leg.market_key);
          const result = row ? row.result : null;

          if (!result) {
            boardPending = true;
            allLegsGreen = false;
          } else if (result === 'red' || result === 'lost') {
            leg.status = 'red';
            boardIsRed = true;
            allLegsGreen = false;
          } else if (result === 'green' || result === 'won') {
            leg.status = 'green';
          }
        }

        // Avalia board
        if (boardIsRed) {
          board.status = 'red';
          ticketIsRed = true;
          allBoardsGreen = false;
        } else if (allLegsGreen && !boardPending) {
          board.status = 'green';
        } else {
          board.status = 'pending';
          ticketPending = true;
          allBoardsGreen = false;
        }
      }

      // Avalia ticket
      if (ticketIsRed) {
        ticket.status = 'red';
      } else if (allBoardsGreen && !ticketPending) {
        ticket.status = 'green';
        allTicketsRed = false;
      } else {
        ticket.status = 'pending';
        allTicketsFinal = false;
        allTicketsRed = false;
      }
    }

    // Avalia submission
    let newStatus = sub.status;
    if (allTicketsFinal) {
      newStatus = allTicketsRed ? 'red' : 'settled';
    }

    if (newStatus !== sub.status || allTicketsFinal || !allTicketsFinal) {
      if (newStatus === 'settled') greenCount++;
      else if (newStatus === 'red') redCount++;
      else pendingCount++;

      if (!dryRun) {
        // Se ainda estiver pending, a gente não vai dar settled_at
        if (newStatus === 'pending' || newStatus === 'submitted') {
          db.prepare(`UPDATE yankee_submissions SET tickets_json = ? WHERE submission_id = ?`)
            .run(JSON.stringify(tickets), sub.submission_id);
        } else {
          updateSubmission.run(JSON.stringify(tickets), newStatus, sub.submission_id);
        }
      }
      
      if (newStatus !== 'pending' && newStatus !== 'submitted') {
        settledCount++;
        // remove duplicate from pendingCount if we added it above by mistake
        // wait, I only incremented one of them above based on newStatus
      }
    }
  }

  return { settled: settledCount, pending: pendingCount, green: greenCount, red: redCount };
}
