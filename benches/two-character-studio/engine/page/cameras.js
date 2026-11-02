// Camera presets: position, look-at target and vertical field of view. A shot moves from preset A to preset B over its
// length (or over `mv` seconds, then holds) with a quintic ease, plus a tiny handheld drift so no two frames are
// identical. Names say what each frames; `frames` tells the QA who is on screen (host, orb, both, tv).
//
// House rules baked into these framings:
// - the speaker is always in frame; the orb's close-ups keep its dock in the shot (it reads as a character on a desk);
// - the TV focus fills most of the frame with the bezel visible: it focuses the screen, it never enters it;
// - in every preset the orb sits beside the host, never in front of his face (no overlap on screen).
const P = (pos, look, fov = 28, frames = 'both') => ({ pos, look, fov, frames });

export const CAMS = {
  // establishing / two-shots
  wide:        P([6.10, 3.00, 16.6], [0.30, -1.60, 0.2], 38),               // the whole set: window, TV, desk, both
  wide_in:     P([5.85, 2.85, 15.6], [0.30, -1.60, 0.2], 38),
  two:         P([2.30, 3.70, 7.6], [1.20, -1.55, 0.6], 49),                // high two-shot over the desk
  two_in:      P([2.20, 3.35, 6.9], [1.20, -1.55, 0.6], 48),
  two_low:     P([5.60, -0.90, 11.6], [1.20, -1.10, 1.0], 28),              // eye-level two-shot from the orb's side
  two_low_in:  P([5.00, -1.00, 10.0], [1.25, -1.10, 1.0], 28),
  // host
  host_med:    P([1.60, -0.45, 9.5], [0.30, -0.80, 0.2], 30, 'host'),       // medium, the TV chart behind him
  host_med_in: P([1.52, -0.45, 8.9], [0.30, -0.78, 0.2], 30, 'host'),
  host_cu:     P([0.75, -0.45, 6.8], [0.10, -0.25, 0.2], 28, 'host'),
  host_cu_in:  P([0.65, -0.42, 5.9], [0.10, -0.22, 0.2], 28, 'host'),
  host_high:   P([1.80, 3.60, 7.0], [1.00, -1.80, 0.6], 42, 'host'),        // high angle over the desk
  host_high_in:P([1.72, 3.35, 6.6], [1.00, -1.80, 0.6], 42, 'host'),
  host_side:   P([-1.70, -0.30, 6.4], [0.15, -0.50, 0.2], 30, 'host'),      // from the TV side, three-quarter
  host_side_in:P([-1.60, -0.30, 6.0], [0.15, -0.50, 0.2], 30, 'host'),
  host_ovr:    P([4.20, -1.15, 3.4], [0.10, -0.55, 0.3], 30, 'host'),       // over the orb: only a slice of it at the lower right
  host_ovr_in: P([4.05, -1.13, 3.15], [0.10, -0.53, 0.3], 30, 'host'),
  // orb
  orb_cu:      P([1.55, -1.00, 8.4], [2.30, -1.66, 1.8], 28, 'orb'),        // framed on the eyes, dock in shot
  orb_cu_in:   P([1.70, -1.08, 7.0], [2.28, -1.58, 1.7], 28, 'orb'),
  orb_ecu:     P([1.85, -1.16, 5.4], [2.22, -1.46, 1.6], 28, 'orb'),
  orb_med:     P([2.60, -0.40, 10.5], [2.70, -1.95, 1.9], 28, 'orb'),
  orb_med_in:  P([2.60, -0.60, 9.0], [2.70, -1.90, 1.9], 28, 'orb'),
  orb_high:    P([3.30, 1.20, 4.6], [2.55, -1.10, 1.6], 40, 'orb'),
  orb_high_in: P([3.24, 1.05, 4.3], [2.55, -1.15, 1.6], 40, 'orb'),
  // the wall TV: a move from the room toward the screen, then the focus (bezel visible, never inside)
  tv:          P([4.00, 1.40, 9.5], [-0.90, 0.30, -3.5], 55, 'tv'),
  tv_in:       P([3.85, 1.32, 8.9], [-0.90, 0.30, -3.5], 54, 'tv'),
  tv_focus:    P([-1.43, 3.60, 6.5], [-1.43, 1.85, -4.2], 66, 'tv'),
  tv_focus_in: P([-1.43, 3.55, 6.2], [-1.43, 1.85, -4.2], 65, 'tv'),
  // the frozen beat: a wide two-shot with both figures in the lower half and room for a fact card above
  pause_wide:  P([5.90, 3.10, 16.2], [0.30, 1.30, 0.2], 38),
  pause_wide_in: P([5.30, 2.80, 14.4], [0.30, 1.15, 0.2], 38),       // a slow creep during the beat: the world is frozen, the picture is not
  // poster / cover: faces below the centred title card
  cover:       P([2.95, -0.40, 15.5], [1.40, 1.55, 1.0], 34),
};

export function framesOf(name){ return (CAMS[name] || {}).frames || null; }
