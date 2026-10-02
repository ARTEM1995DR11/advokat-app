function matterFolderShell(){
  var uid='mfs'+(++MATTER_FOLDER_SHELL_SEQ);
  var front='M48 96 H257 C269 96 276 102 284 111 C292 120 298 121 309 121 H397 C413 121 424 133 424 150 V408 C424 427 412 438 392 438 H49 C28 438 16 426 16 405 V128 C16 109 28 96 48 96 Z';
  var back='M16 143 V84 C16 69 22 60 34 54 C44 49 49 45 55 38 C63 27 74 23 88 23 H245 C257 23 263 30 268 40 C274 54 290 93 298 109 C302 117 308 120 316 123 H337 V179 H16 Z';
  var shoulder='M319 47 H396.5 C407.8 47 416.4 54.2 421 64.7 C425.6 75.3 427 90.5 427 108.2 C427 132.8 425.1 157.6 423.2 178.1 C422 190.7 415.2 198.6 404 201 H319 Z';
  var tab='M58 116 V102 C58 89 60.8 77 67 62 C73 47.5 81.8 41 95 41 H244 C257 41 264 47 269 57.5 C274.5 69 282.5 93 292 107.5 C300.5 120 305 123 312 123 H318 V156 H58 Z';
  var sheets=[
    'M226 26.4 C274.8 25.0 323.8 23.2 371.6 23.8 Q374.0 23.84 374.2 26.34 C374.7 62.8 375.4 107.2 376.0 146.5 H238.2 Z',
    'M239 39.6 C286.2 38.1 337.8 38.7 388.3 40.1 Q390.7 40.18 390.85 42.58 C391.45 70.0 392.2 112.8 392.9 157.8 H247.6 Z',
    'M252 54.0 C298.0 52.7 350.6 54.2 404.1 55.0 Q406.5 55.08 406.65 57.48 C407.2 83.2 407.9 122.8 408.4 165.2 H255.8 Z',
    'M265.5 68.8 C310.2 67.9 361.4 69.3 418.3 70.4 Q420.7 70.48 420.85 72.88 C421.2 100.2 421.4 137.2 421.7 174.8 H264.4 Z'
  ];
  function shadow(name,dx,dy,blur,alpha,color){return '<filter id="'+uid+'-'+name+'" x="-32%" y="-45%" width="176%" height="200%" color-interpolation-filters="sRGB"><feDropShadow dx="'+dx+'" dy="'+dy+'" stdDeviation="'+blur+'" flood-color="'+color+'" flood-opacity="'+alpha+'"/></filter>';}
  return `<svg class="case-folder-shell" viewBox="0 0 440 458" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <path id="${uid}-face" d="${front}"/>
      <clipPath id="${uid}-backClip"><path d="${back}"/></clipPath>
      <linearGradient id="${uid}-rimDepth" gradientUnits="userSpaceOnUse" x1="0" y1="96" x2="0" y2="180"><stop stop-color="#b18a46"/><stop offset=".45" stop-color="#936323"/><stop offset="1" stop-color="#754809"/></linearGradient>
      <clipPath id="${uid}-tabClip"><path d="${tab}"/></clipPath>
      <clipPath id="${uid}-shoulderClip"><path d="${shoulder}"/></clipPath>
      <linearGradient id="${uid}-shoulderRound" gradientUnits="userSpaceOnUse" x1="389" y1="0" x2="427" y2="0"><stop stop-color="var(--folder-light)" stop-opacity=".20"/><stop offset=".42" stop-color="var(--folder-light)" stop-opacity=".065"/><stop offset=".7" stop-color="var(--folder-deep)" stop-opacity="0"/><stop offset="1" stop-color="var(--folder-deep)" stop-opacity=".09"/></linearGradient>
      <path id="${uid}-sheet1" d="${sheets[0]}"/>
      <path id="${uid}-sheet2" d="${sheets[1]}"/>
      <path id="${uid}-sheet3" d="${sheets[2]}"/>
      <path id="${uid}-sheet4" d="${sheets[3]}"/>
      <clipPath id="${uid}-paperClip1"><use href="#${uid}-sheet1"/></clipPath>
      <clipPath id="${uid}-paperClip2"><use href="#${uid}-sheet2"/></clipPath>
      <clipPath id="${uid}-paperClip3"><use href="#${uid}-sheet3"/></clipPath>
      <clipPath id="${uid}-frontPaperClip"><use href="#${uid}-sheet4"/></clipPath>
      <filter id="${uid}-paperContact" x="-14%" y="-22%" width="132%" height="152%" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="2.55"/></filter>
      <filter id="${uid}-tabInset" x="-10%" y="-10%" width="120%" height="120%" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="1.3"/></filter>

      <!-- Stage 2: deeper rear shell, brighter inner tab, cleaner right shoulder. -->
      <linearGradient id="${uid}-back" x1=".02" y1="0" x2=".98" y2=".72">
        <stop offset="0" stop-color="var(--folder-deep)"/>
        <stop offset=".16" stop-color="var(--folder)"/>
        <stop offset=".40" stop-color="var(--folder-deep)"/>
        <stop offset=".82" stop-color="var(--folder-deep)"/>
        <stop offset="1" stop-color="var(--folder)"/>
      </linearGradient>
      <linearGradient id="${uid}-backSheen" x1=".04" y1="0" x2=".84" y2=".28">
        <stop stop-color="var(--folder-light)" stop-opacity=".13"/>
        <stop offset=".22" stop-color="var(--folder-light)" stop-opacity=".042"/>
        <stop offset=".58" stop-color="var(--folder-light)" stop-opacity="0"/>
        <stop offset="1" stop-color="var(--folder-deep)" stop-opacity=".075"/>
      </linearGradient>
      <linearGradient id="${uid}-tab" x1=".06" y1="0" x2=".70" y2="1">
        <stop offset="0" stop-color="var(--folder-light)"/>
        <stop offset=".18" stop-color="var(--folder-light)"/>
        <stop offset=".60" stop-color="var(--folder)"/>
        <stop offset=".84" stop-color="var(--folder)"/>
        <stop offset=".96" stop-color="var(--folder)"/>
        <stop offset="1" stop-color="var(--folder-deep)"/>
      </linearGradient>
      <linearGradient id="${uid}-tabSheen" x1=".10" y1="0" x2=".60" y2=".96">
        <stop stop-color="#fff" stop-opacity=".30"/>
        <stop offset=".28" stop-color="#fff" stop-opacity=".13"/>
        <stop offset=".48" stop-color="#fff" stop-opacity=".025"/>
        <stop offset=".68" stop-color="#fff" stop-opacity="0"/>
        <stop offset="1" stop-color="var(--folder-deep)" stop-opacity=".055"/>
      </linearGradient>

      <linearGradient id="${uid}-cream" x1=".05" y1="0" x2=".92" y2="1"><stop stop-color="#fffefa"/><stop offset=".30" stop-color="#fffaf0"/><stop offset=".64" stop-color="#faf3e6"/><stop offset=".88" stop-color="#f4ead9"/><stop offset="1" stop-color="#eadcc7"/></linearGradient>
      <radialGradient id="${uid}-creamGlow" cx=".24" cy=".15" r=".92"><stop stop-color="#fff" stop-opacity=".66"/><stop offset=".44" stop-color="#fff" stop-opacity=".12"/><stop offset=".78" stop-color="#f0dec0" stop-opacity=".05"/><stop offset="1" stop-color="#c98c2a" stop-opacity=".10"/></radialGradient>

      <!-- Four compact leaves: depth is primarily contact shadow, not enlarged spacing.
           Each shadow is clipped to its receiving leaf; both colored left bodies cover the whole stack. -->
      <linearGradient id="${uid}-paperA" gradientUnits="userSpaceOnUse" x1="296" y1="18" x2="302" y2="141"><stop stop-color="#fffefc"/><stop offset=".40" stop-color="#fcf8f1"/><stop offset="1" stop-color="#eee4d5"/></linearGradient>
      <linearGradient id="${uid}-paperB" gradientUnits="userSpaceOnUse" x1="309" y1="31" x2="315" y2="144"><stop stop-color="#fffefc"/><stop offset=".42" stop-color="#fcf7f0"/><stop offset="1" stop-color="#efe4d6"/></linearGradient>
      <linearGradient id="${uid}-paperC" gradientUnits="userSpaceOnUse" x1="323" y1="44" x2="329" y2="149"><stop stop-color="#ffffff"/><stop offset=".44" stop-color="#fdf9f2"/><stop offset="1" stop-color="#f1e7d9"/></linearGradient>
      <linearGradient id="${uid}-paperD" gradientUnits="userSpaceOnUse" x1="334" y1="58" x2="338" y2="156"><stop stop-color="#ffffff"/><stop offset=".44" stop-color="#fefbf6"/><stop offset="1" stop-color="#f4ecdf"/></linearGradient>
      <linearGradient id="${uid}-paperSeat" gradientUnits="userSpaceOnUse" x1="0" y1="90" x2="0" y2="130"><stop stop-color="#8a7457" stop-opacity="0"/><stop offset=".46" stop-color="#8a7457" stop-opacity=".11"/><stop offset="1" stop-color="#796247" stop-opacity=".28"/></linearGradient>
      <clipPath id="${uid}-paperClip"><use href="#${uid}-sheet1"/><use href="#${uid}-sheet2"/><use href="#${uid}-sheet3"/><use href="#${uid}-sheet4"/></clipPath>
      <linearGradient id="${uid}-paperEdge" x1="0" y1="0" x2="1" y2="0"><stop offset=".936" stop-color="#917c62" stop-opacity="0"/><stop offset=".966" stop-color="#917c62" stop-opacity=".18"/><stop offset=".986" stop-color="#917c62" stop-opacity=".36"/><stop offset="1" stop-color="#917c62" stop-opacity=".24"/></linearGradient>
      <linearGradient id="${uid}-paperOutline" gradientUnits="userSpaceOnUse" x1="226" y1="22" x2="422" y2="176"><stop stop-color="#f2e8d9" stop-opacity=".96"/><stop offset=".56" stop-color="#d6c8b5" stop-opacity=".60"/><stop offset="1" stop-color="#bca88f" stop-opacity=".44"/></linearGradient>
      <filter id="${uid}-paperInset" x="-15%" y="-15%" width="130%" height="130%"><feGaussianBlur stdDeviation="1.6"/></filter>
      <filter id="${uid}-paperSepBlur" x="-22%" y="-120%" width="160%" height="340%" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="1.15"/></filter>
      <filter id="${uid}-paperLip" x="-18%" y="-80%" width="140%" height="260%" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="1.15"/></filter>

      <linearGradient id="${uid}-gold" x1="0" y1="0" x2=".12" y2="1"><stop stop-color="#b7832a"/><stop offset=".06" stop-color="#c98a20"/><stop offset=".13" stop-color="#fff0ab"/><stop offset=".23" stop-color="#d99c2c"/><stop offset=".48" stop-color="#f7d47b"/><stop offset=".70" stop-color="#a36312"/><stop offset=".88" stop-color="#e7ae39"/><stop offset=".94" stop-color="#9a5509"/><stop offset=".972" stop-color="#f8d87a"/><stop offset=".988" stop-color="#fff6c5"/><stop offset="1" stop-color="#85500c"/></linearGradient>
      <linearGradient id="${uid}-goldBevel" x1="0" y1="0" x2=".14" y2="1"><stop stop-color="#fff2b5"/><stop offset=".3" stop-color="#e7b952"/><stop offset=".58" stop-color="#fbe397"/><stop offset=".85" stop-color="#ae7219"/><stop offset=".96" stop-color="#e4b64d"/><stop offset=".986" stop-color="#fff6ce"/><stop offset="1" stop-color="#bd872b"/></linearGradient>
      <linearGradient id="${uid}-goldGlint" gradientUnits="userSpaceOnUse" x1="16" y1="438" x2="424" y2="407"><stop stop-color="#ffefb3"/><stop offset=".06" stop-color="#fffce6"/><stop offset=".16" stop-color="#d69d34"/><stop offset=".3" stop-color="#fff0af"/><stop offset=".53" stop-color="#ad731a"/><stop offset=".76" stop-color="#ffe8ac"/><stop offset=".94" stop-color="#fffbe3"/><stop offset="1" stop-color="#dcaa41"/></linearGradient>

      ${shadow('contact',0,9.4,9.7,.235,'#66503a')}
      ${shadow('rear',.5,2,3.2,.11,'#40504a')}
      ${shadow('shoulder',0,1,5.4,.04,'#776954')}
      ${shadow('rearInner',0,1.15,1.25,.12,'#111111')}
      ${shadow('paperShadowA',.98,1.62,1.92,.27,'#897964')}
      ${shadow('paperShadowB',1.12,1.78,2.06,.31,'#897964')}
      ${shadow('paperShadowC',1.26,1.94,2.18,.34,'#897964')}
      ${shadow('paperShadowD',1.38,2.08,2.28,.37,'#897964')}
      ${shadow('tabShadow',0,.9,2.8,.032,'#40504a')}
      ${shadow('tabLift',0,1.3,1.3,.12,'#111111')}
      ${shadow('frontShadow',0,5.3,7.3,.22,'#66503a')}
      ${shadow('trimGlow',0,.8,1.3,.13,'#98713d')}

      <filter id="${uid}-grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".72" numOctaves="3" seed="19"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="linear" slope=".034"/></feComponentTransfer><feComposite in2="SourceGraphic" operator="in"/><feBlend in="SourceGraphic" mode="multiply"/></filter>
    </defs>

    <path data-layer="contact" d="${front}" fill="#76502b" opacity=".74" filter="url(#${uid}-contact)"/>


    <!-- Back to front: shoulder → papers → left rear body → inner tab → face. -->
    <g data-layer="rear-shoulder" filter="url(#${uid}-shoulder)">
      <path d="${shoulder}" fill="url(#${uid}-back)" filter="url(#${uid}-grain)"/>
      <path d="${shoulder}" fill="url(#${uid}-backSheen)" opacity=".24"/>
      <path d="${shoulder}" fill="url(#${uid}-shoulderRound)"/>
      <g clip-path="url(#${uid}-shoulderClip)"><path d="${shoulder}" transform="translate(1.2 2.5)" fill="none" stroke="var(--folder-light)" stroke-width=".95" opacity=".10" stroke-linejoin="round"/></g>
    </g>

    <g data-layer="papers">
      <g data-sheet="1" filter="url(#${uid}-paperShadowA)">
        <use href="#${uid}-sheet1" fill="url(#${uid}-paperA)"/><use href="#${uid}-sheet1" fill="url(#${uid}-paperEdge)"/><use href="#${uid}-sheet1" fill="none" stroke="url(#${uid}-paperOutline)" stroke-width=".72" opacity=".68"/>
        <g clip-path="url(#${uid}-paperClip1)"><use href="#${uid}-sheet2" transform="translate(1.18 1.98)" fill="#8c7861" opacity="0.42" filter="url(#${uid}-paperContact)"/></g>
        <g clip-path="url(#${uid}-paperClip1)"><path d="M228 28 C274 26.8 320 24.2 364.2 24.6" transform="translate(1.04 1.94)" fill="none" stroke="#7c6957" stroke-width="1.88" opacity=".24" filter="url(#${uid}-paperSepBlur)"/></g>
        <g clip-path="url(#${uid}-paperClip1)"><path d="M228 28 C274 26.8 320 24.2 364.2 24.6" transform="translate(0 .52)" fill="none" stroke="#fffefb" stroke-width=".82" opacity=".96"/></g>
        <g clip-path="url(#${uid}-paperClip1)"><path d="M366.9 27.4 C367.2 61.8 367.8 103.4 368.3 143.2" fill="none" stroke="#a69279" stroke-width="1.34" opacity=".40"/></g>
      </g>
      <g data-sheet="2" filter="url(#${uid}-paperShadowB)">
        <use href="#${uid}-sheet2" fill="url(#${uid}-paperB)"/><use href="#${uid}-sheet2" fill="url(#${uid}-paperEdge)"/><use href="#${uid}-sheet2" fill="none" stroke="url(#${uid}-paperOutline)" stroke-width=".70" opacity=".64"/>
        <g clip-path="url(#${uid}-paperClip2)"><use href="#${uid}-sheet3" transform="translate(1.26 2.04)" fill="#8c7861" opacity="0.44" filter="url(#${uid}-paperContact)"/></g>
        <g clip-path="url(#${uid}-paperClip2)"><path d="M236 40 C281 38.3 331 38.9 379.7 40.5" transform="translate(1.08 1.98)" fill="none" stroke="#7c6957" stroke-width="1.90" opacity=".25" filter="url(#${uid}-paperSepBlur)"/></g>
        <g clip-path="url(#${uid}-paperClip2)"><path d="M236 40 C281 38.3 331 38.9 379.7 40.5" transform="translate(0 .52)" fill="none" stroke="#fffefb" stroke-width=".82" opacity=".96"/></g>
        <g clip-path="url(#${uid}-paperClip2)"><path d="M382 43.1 C382.5 69.8 383.3 111 384 153.1" fill="none" stroke="#a69279" stroke-width="1.38" opacity=".42"/></g>
      </g>
      <g data-sheet="3" filter="url(#${uid}-paperShadowC)">
        <use href="#${uid}-sheet3" fill="url(#${uid}-paperC)"/><use href="#${uid}-sheet3" fill="url(#${uid}-paperEdge)"/><use href="#${uid}-sheet3" fill="none" stroke="url(#${uid}-paperOutline)" stroke-width=".68" opacity=".60"/>
        <g clip-path="url(#${uid}-paperClip3)"><use href="#${uid}-sheet4" transform="translate(1.34 2.10)" fill="#8c7861" opacity="0.46" filter="url(#${uid}-paperContact)"/></g>
        <g clip-path="url(#${uid}-paperClip3)"><path d="M244.5 53.8 C289.5 52.6 341 54.3 394.1 55.1" transform="translate(1.12 2.05)" fill="none" stroke="#7c6957" stroke-width="1.94" opacity=".27" filter="url(#${uid}-paperSepBlur)"/></g>
        <g clip-path="url(#${uid}-paperClip3)"><path d="M244.5 53.8 C289.5 52.6 341 54.3 394.1 55.1" transform="translate(0 .54)" fill="none" stroke="#fffefb" stroke-width=".82" opacity=".95"/></g>
        <g clip-path="url(#${uid}-paperClip3)"><path d="M396.4 57.8 C396.8 83 397.6 121.2 398.1 162.0" fill="none" stroke="#a69279" stroke-width="1.40" opacity=".44"/></g>
      </g>
      <g data-sheet="4" filter="url(#${uid}-paperShadowD)">
        <use href="#${uid}-sheet4" fill="url(#${uid}-paperD)"/><use href="#${uid}-sheet4" fill="url(#${uid}-paperEdge)"/><use href="#${uid}-sheet4" fill="none" stroke="url(#${uid}-paperOutline)" stroke-width=".66" opacity=".58"/>
        <g clip-path="url(#${uid}-frontPaperClip)"><path d="M253 68.4 C296.5 67.6 346.8 69.2 405.5 70.5" transform="translate(1.18 2.12)" fill="none" stroke="#7c6957" stroke-width="1.98" opacity=".29" filter="url(#${uid}-paperSepBlur)"/></g>
        <g clip-path="url(#${uid}-frontPaperClip)"><path d="M253 68.4 C296.5 67.6 346.8 69.2 405.5 70.5" transform="translate(0 .54)" fill="none" stroke="#fffefb" stroke-width=".84" opacity=".97"/></g>
        <g clip-path="url(#${uid}-frontPaperClip)"><path d="M408.1 73.3 C408.3 98.7 408.5 134.2 408.7 170" fill="none" stroke="#a69279" stroke-width="1.44" opacity=".46"/></g>
      </g>
      <!-- Compact four-leaf stack: depth comes from inter-leaf contact shadows, not a large fan. -->
      <g clip-path="url(#${uid}-paperClip)">
        <path d="M232 90 H425 V140 H232 Z" fill="url(#${uid}-paperSeat)" opacity="1"/>
        <path d="M268 40 C274 54 290 93 298 109 C302 117 308 120 316 123" transform="translate(1.26 2.02)" fill="none" stroke="#735f49" stroke-width="3.25" opacity=".18" filter="url(#${uid}-paperInset)"/>
      </g>
    </g>
    <g data-layer="rear" filter="url(#${uid}-rear)">
      <path d="${back}" fill="url(#${uid}-back)" filter="url(#${uid}-grain)"/>
      <path d="${back}" fill="url(#${uid}-backSheen)" opacity=".26"/>
      <g clip-path="url(#${uid}-backClip)"><path d="${back}" transform="translate(1.6 2)" fill="none" stroke="var(--folder-light)" stroke-width="1" opacity=".095" stroke-linejoin="round"/></g>
      <path d="M24 85 C29 70 37 64 49 56 C60 49 68 36 80 31" fill="none" stroke="#fff" stroke-width=".72" opacity=".06" stroke-linecap="round"/>
      <path d="M19 139 H333" fill="none" stroke="#111" stroke-width="1" opacity=".082" filter="url(#${uid}-rearInner)"/>
      <path d="M22 137 V91" fill="none" stroke="rgba(0,0,0,.090)" stroke-width="1.1"/>
    </g>

    <g data-layer="tab" filter="url(#${uid}-tabShadow)">
      <path d="${tab}" fill="url(#${uid}-tab)" filter="url(#${uid}-grain)"/>
      <path d="${tab}" fill="url(#${uid}-tabSheen)" style="opacity:var(--folder-tab-sheen,.38)"/>
      <g clip-path="url(#${uid}-tabClip)"><path d="${tab}" transform="translate(1.2 1.4)" fill="none" stroke="#fff" stroke-width=".8" opacity=".055" stroke-linecap="round" stroke-linejoin="round"/></g>
      <g clip-path="url(#${uid}-tabClip)"><path d="${tab}" transform="translate(-.7 -1)" fill="none" stroke="var(--folder-deep)" stroke-width="3.5" style="opacity:var(--folder-inner-shadow,.065)" filter="url(#${uid}-tabInset)" stroke-linejoin="round"/></g>
      <path d="M58 153 H313" fill="none" stroke="#111" stroke-width=".88" opacity=".058" filter="url(#${uid}-tabLift)"/>
    </g>

    <g data-layer="front" filter="url(#${uid}-frontShadow)">
      <use href="#${uid}-face" fill="url(#${uid}-cream)" filter="url(#${uid}-grain)"/>
      <use href="#${uid}-face" fill="url(#${uid}-creamGlow)" opacity=".52"/>
      <path d="M49 99 H257 C269 99 276 105 284 114 C292 123 298 124 309 124 H396" fill="none" stroke="#fffef9" stroke-width="1.2" opacity=".50" stroke-linecap="round"/>
    </g>

    <g data-layer="trim" fill="none" stroke-linejoin="round" stroke-linecap="round" filter="url(#${uid}-trimGlow)">
      <use href="#${uid}-face" stroke="url(#${uid}-rimDepth)" stroke-width="6.35"/>
      <use href="#${uid}-face" stroke="url(#${uid}-gold)" stroke-width="4.72"/>
      <use href="#${uid}-face" stroke="url(#${uid}-goldBevel)" stroke-width="2.05" opacity=".94"/>
      <use href="#${uid}-face" stroke="url(#${uid}-goldGlint)" stroke-width=".92" opacity=".94"/>
      <!-- Two fine reflections sit inside the existing 6.35-unit rim. -->
      <path d="M16 389 V405 C16 426 28 438 49 438 H392 C412 438 424 427 424 408 V389" transform="translate(0 -1.1)" stroke="url(#${uid}-goldGlint)" stroke-width="1.15" opacity=".88"/>
      <path d="M16 399 V405 C16 426 28 438 49 438 H392 C412 438 424 427 424 408 V399" transform="translate(0 1.05)" stroke="#8a5410" stroke-width=".65" opacity=".46"/>
    </g>
  </svg>`;
}