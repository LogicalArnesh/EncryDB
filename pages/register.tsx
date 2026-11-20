import { useState } from "react";
import { useRouter } from "next/router";
import Register from "../components/Register";

export default function RegisterPage() {
  const router = useRouter();
  return <Register onSwitchToLogin={() => router.push("/")} />;
}