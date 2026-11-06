export async function stopRide({elapsed, confirmStop, clearCheckpoint, stop}) {
    if(!confirmStop('Confirm Stop?')) return;
    const discard = elapsed < 60 && !confirmStop('This ride is less than one minute. Save it? Select Cancel to discard it.');
    if(discard) await clearCheckpoint();
    stop(discard);
}
