import type { Metadata } from "next";
import Clinic from "../../components/clinic";

export const metadata: Metadata = {title: "My bookings | Koya Clinic"};

export default function Bookings() {
  return <Clinic view="bookings" />;
}
