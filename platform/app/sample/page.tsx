import {redirect} from 'next/navigation';
/** The demo begins with an OMR upload, not the pre-populated class overview. */
export default function DemoEntry(){redirect('/sample/scan');}
