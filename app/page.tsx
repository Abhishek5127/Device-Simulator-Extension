"use client"
import { Canvas } from "@react-three/fiber";
import {OrbitControls, Box} from "@react-three/drei"

export default function Home() {
  return (
    <main>
      <Canvas camera={{position:[0,0,3]}}>
      <ambientLight intensity={1}/>
      <directionalLight position={[2,2,2]}/>

      <Box args={[1,1,1]}>
        <meshStandardMaterial color="grey"/> 
      </Box>
      <OrbitControls/>
      </Canvas>
    </main>
  );
}
