import { Transform } from "./model";

/** Advance the tracker by one turn. Pure — returns a new state. */
export const endTurn: Transform = (state) => ({ ...state, position: state.position + 1 });
