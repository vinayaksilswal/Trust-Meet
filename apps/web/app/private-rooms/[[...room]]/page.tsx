import { notFound } from "next/navigation";
import { z } from "zod";
import { PrivateRooms } from "@/components/private-rooms";

export default async function Rooms({ params }: { params: Promise<{ room?: string[] }> }) {
  const { room } = await params;
  if (room && (room.length !== 1 || !z.uuid().safeParse(room[0]).success)) notFound();
  return <PrivateRooms id={room?.[0]} />;
}
