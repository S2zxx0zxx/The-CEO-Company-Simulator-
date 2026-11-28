import {useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {RailwayGuestShell} from '../src/ui/railway/GuestShell';
import {initRailwayPwa} from '../src/rail/guest/pwa';
function Entry(){const [state,setState]=useState({offlineReady:false,updateReady:false}),[error,setError]=useState('');useEffect(()=>{void initRailwayPwa(setState).catch(e=>setError(String(e)));},[]);return <>{error&&<p role="alert">{error}</p>}<RailwayGuestShell {...state}/></>;}
createRoot(document.getElementById('root')!).render(<Entry/>);
