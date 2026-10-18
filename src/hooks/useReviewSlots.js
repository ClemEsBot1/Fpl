// The players read from a screenshot, as they're checked and fixed on the
// review screen.
import { useState } from 'react';

export function useReviewSlots() {
  const [reviewSlots, setReviewSlots] = useState([]);

  function updateSlotMatch(index, player) {
    setReviewSlots(prev => prev.map((s, i) => i === index ? { ...s, matched: player, manuallyFixed: true } : s));
  }

  // Only one captain and one vice-captain at a time, never the same player
  // as both, and only for starters. Clicking the checkbox that's already
  // checked for a player unsets it (so you can end up with none selected
  // mid-edit, rather than being forced to immediately pick a replacement).
  function updateSlotCaptain(index) {
    setReviewSlots(prev => prev.map((s, i) => {
      if (i === index) {
        const nowCaptain = !s.isCaptain && s.isStarting;
        return { ...s, isCaptain: nowCaptain, isViceCaptain: nowCaptain ? false : s.isViceCaptain };
      }
      return { ...s, isCaptain: false };
    }));
  }

  function updateSlotViceCaptain(index) {
    setReviewSlots(prev => prev.map((s, i) => {
      if (i === index) {
        const nowVice = !s.isViceCaptain && s.isStarting;
        return { ...s, isViceCaptain: nowVice, isCaptain: nowVice ? false : s.isCaptain };
      }
      return { ...s, isViceCaptain: false };
    }));
  }

  // Moves a read player between the starting XI and the bench (the reader
  // can get that wrong when it misses a name). A benched player loses any
  // armband.
  function updateSlotStarting(index) {
    setReviewSlots(prev => prev.map((s, i) => {
      if (i !== index) return s;
      const isStarting = !s.isStarting;
      return isStarting ? { ...s, isStarting } : { ...s, isStarting, isCaptain: false, isViceCaptain: false };
    }));
  }

  return { reviewSlots, setReviewSlots, updateSlotMatch, updateSlotCaptain, updateSlotViceCaptain, updateSlotStarting };
}
