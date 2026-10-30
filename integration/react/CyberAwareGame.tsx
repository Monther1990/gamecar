// React component for the Cyber Aware platform: shows one of the 3D awareness games in an iframe and hands the finished
// run to the page. One component serves every game built from this template; copy it once into the React app and serve
// each game's built folder (its dist/) at its own path, e.g. /games/<gameId>/.
//
//   <CyberAwareGame src="/games/my-game/index.html" title="..." onComplete={({ result, ledger }) => api.post('/games/results', { gameId: result.gameId, ledger })} />
//
// Security: the game posts only to the origin passed in `parentOrigin`, and this component accepts messages only from the
// game's own origin AND its own iframe window. Treat the result as display data: send the `ledger` (decisions) to your
// server and let the server recompute the score.
import { useEffect, useMemo, useRef } from 'react';

export interface GameResult {
	result: {
		gameId: string; assessmentVersion: string; runId: string; displayName: string; avatarId: 'male' | 'female';
		earnedPoints: number; maximumPoints: number; scorePercent: number; completionPercent: number;
		completed: boolean; passed: boolean; status: 'in_progress' | 'passed' | 'needs_practice'; passThresholdPercent: number;
		missionResults: { missionId: string; titleAr: string; earnedPoints: number; maximumPoints: number }[];
	};
	ledger: { eventId: string; runId: string; checkpointId: string; actionId: string; outcome: string; at: string }[];
	/** Cyber Rally only: race numbers for fun (stars, shields, time, beat the virus). Never part of the score. */
	fun?: { stars: number; coins: number; coinsTotal: number; seconds: number; beatVirus: boolean };
}

export function CyberAwareGame(props: { src: string; title: string; onComplete?: (r: GameResult) => void;
	onEvent?: (type: string, data: unknown) => void; className?: string; style?: React.CSSProperties }) {
	const frame = useRef<HTMLIFrameElement>(null);
	const gameUrl = useMemo(() => {
		const u = new URL(props.src, window.location.href);
		u.searchParams.set('parentOrigin', window.location.origin);
		return u;
	}, [props.src]);

	useEffect(() => {
		const onMessage = (e: MessageEvent) => {
			if (e.origin !== gameUrl.origin || e.source !== frame.current?.contentWindow) return;
			const msg = e.data;
			if (!msg || msg.protocolVersion !== 1 || typeof msg.type !== 'string') return;
			if (msg.type === 'game.completed') props.onComplete?.(msg.data as GameResult);
			else props.onEvent?.(msg.type, msg.data);
		};
		window.addEventListener('message', onMessage);
		return () => window.removeEventListener('message', onMessage);
	}, [gameUrl, props.onComplete, props.onEvent]);

	return (
		<iframe ref={frame} src={gameUrl.toString()} title={props.title} className={props.className}
			style={{ border: 0, width: '100%', height: '100%', display: 'block', ...props.style }}
			allow="autoplay; fullscreen" />
	);
}
