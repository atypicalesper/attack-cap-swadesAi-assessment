import { NextRequest, NextResponse } from "next/server";
import { AccessToken } from "livekit-server-sdk";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const room = params.get("room") || "clinic-demo";
  const identity = params.get("identity") || `user-${Math.random().toString(36).slice(2, 8)}`;
  const name = params.get("name") || identity;

  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  const url = process.env.LIVEKIT_URL || process.env.NEXT_PUBLIC_LIVEKIT_URL;

  if (!apiKey || !apiSecret || !url) {
    return NextResponse.json(
      { error: "LiveKit env not configured (LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET)" },
      { status: 500 },
    );
  }

  const at = new AccessToken(apiKey, apiSecret, { identity, name });
  at.addGrant({
    roomJoin: true,
    room,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });

  const token = await at.toJwt();
  return NextResponse.json({ token, url, room, identity });
}
