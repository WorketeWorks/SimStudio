import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
const geistSans=Geist({variable:"--font-geist-sans",subsets:["latin"]});
const geistMono=Geist_Mono({variable:"--font-geist-mono",subsets:["latin"]});
export const metadata:Metadata={title:"Sim Studio — Physics Build Lab",description:"Construye mecanismos y prueba su física directamente en el navegador."};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="es"><body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body></html>}
