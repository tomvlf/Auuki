import {renderPowerProfile} from '../../src/views/power-profile.js';

test('renders planned interval steps as a wattage profile', () => {
    const markup = renderPowerProfile({
        label: 'Threshold <ride>',
        ftp: 200,
        intervals: [{steps: [
            {duration: 300, power: 0.5},
            {duration: 600, power: 1},
        ]}],
    });

    expect(markup).toContain('class="power-profile--target"');
    expect(markup).toContain('Threshold &lt;ride&gt;');
    expect(markup).toContain('role="img"');
});

test('renders sampled ride power and omits unavailable profiles', () => {
    expect(renderPowerProfile({samples: [100, 120, 180], ftp: 200}))
        .toContain('class="power-profile--recorded"');
    expect(renderPowerProfile({samples: [0, NaN, -1]})).toBe('');
});

test('does not show an invented FTP reference on recorded profiles', () => {
    expect(renderPowerProfile({samples: [100, 120, 180]})).not.toContain('power-profile--ftp');
    expect(renderPowerProfile({samples: [100, 120, 180], ftp: 250})).toContain('power-profile--ftp');
});
