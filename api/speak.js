async function speakReply(text) {
      try {
        if (currentAudio) {
          currentAudio.pause();
          currentAudio = null;
        }

        const cleanText = text
          .replace(/\*\*/g, '').replace(/\*/g, '')
          .replace(/#{1,6}/g, '').replace(/`/g, '')
          .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1')
          .trim();

        setOrbState('speaking', 'SCORPION SPEAKING...');

        const response = await fetch('/api/speak', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: cleanText })
        });

        if (!response.ok) {
          let errMsg = 'Voice generation failed';
          try {
            const errData = await response.json();
            errMsg = errData.error || errMsg;
          } catch(e) {}
          console.error('Voice error:', errMsg);
          setOrbState('', 'VOICE ERROR - TAP ORB TO RETRY');
          return;
        }

        const blob = await response.blob();
        const audioUrl = URL.createObjectURL(blob);
        const audio = new Audio(audioUrl);
        currentAudio = audio;
        audio.onended = () => {
          URL.revokeObjectURL(audioUrl);
          setOrbState('', 'TAP THE ORB TO SPEAK');
        };
        audio.onerror = () => setOrbState('', 'VOICE ERROR - TAP ORB TO RETRY');
        audio.play();

      } catch(e) {
        console.error('Voice error:', e);
        setOrbState('', 'TAP THE ORB TO SPEAK');
      }
    }
