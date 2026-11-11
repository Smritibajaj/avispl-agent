import type { Metadata } from "next";
import { KnowledgeGraph } from "../../components/KnowledgeGraph";

export const metadata: Metadata = { title: "Knowledge graph | AVI-SPL meeting-room advisor" };

export default function GraphPage() {
  return <KnowledgeGraph />;
}
