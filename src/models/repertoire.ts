export type RepertoireColor = 'white' | 'black';

/**
 * One repertoire decision: at the position `epd` (with `color` to move), the
 * user's book move is `uci`. The repertoire "tree" is reconstructed by walking
 * from the start position — own-side nodes follow the stored move, opponent
 * nodes branch over observed/book replies.
 */
export interface RepertoireMove {
  id: string;
  color: RepertoireColor;
  epd: string;
  uci: string;
  san: string;
  createdAt: Date;
}

export function repertoireMoveFromJson(json: any): RepertoireMove {
  return {
    id: json.id as string,
    color: json.color === 'black' ? 'black' : 'white',
    epd: json.epd as string,
    uci: json.uci as string,
    san: json.san as string,
    createdAt: new Date(json.created_at as string),
  };
}
