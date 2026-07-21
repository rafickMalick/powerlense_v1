import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { palette } from '@/theme/colors';

interface Props {
  value: string;        // format "HH:MM"
  onChange: (time: string) => void;
  label?: string;
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export function TimeInput({ value, onChange, label }: Props) {
  const [hh, mm] = value ? value.split(':') : ['00', '00'];
  const hours   = parseInt(hh || '0', 10);
  const minutes = parseInt(mm || '0', 10);

  const emit = (h: number, m: number) => {
    onChange(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
  };

  const step = (field: 'h' | 'm', delta: number) => {
    if (field === 'h') emit(clamp(hours + delta, 0, 23), minutes);
    else emit(hours, clamp(minutes + delta, 0, 59));
  };

  const inputStyle = {
    color: palette.gray900,
    fontSize: 20,
    fontWeight: '600' as const,
    textAlign: 'center' as const,
    width: 48,
    backgroundColor: palette.gray100,
    borderRadius: 6,
    paddingVertical: 6,
  };

  const btnStyle = {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: palette.gray200,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  };

  return (
    <View>
      {label && (
        <Text style={{ color: palette.gray500, fontSize: 13, fontWeight: '500', marginBottom: 4 }}>
          {label}
        </Text>
      )}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 }}>
        {/* Heures */}
        <View style={{ alignItems: 'center', gap: 4 }}>
          <Pressable style={btnStyle} onPress={() => step('h', 1)}>
            <Text style={{ color: palette.gray900, fontSize: 16 }}>▲</Text>
          </Pressable>
          <TextInput
            style={inputStyle}
            value={String(hours).padStart(2, '0')}
            keyboardType="numeric"
            maxLength={2}
            onChangeText={(v) => { const n = parseInt(v, 10); if (!isNaN(n)) emit(clamp(n, 0, 23), minutes); }}
          />
          <Pressable style={btnStyle} onPress={() => step('h', -1)}>
            <Text style={{ color: palette.gray900, fontSize: 16 }}>▼</Text>
          </Pressable>
        </View>

        <Text style={{ color: palette.gray900, fontSize: 24, fontWeight: 'bold' }}>:</Text>

        {/* Minutes */}
        <View style={{ alignItems: 'center', gap: 4 }}>
          <Pressable style={btnStyle} onPress={() => step('m', 5)}>
            <Text style={{ color: palette.gray900, fontSize: 16 }}>▲</Text>
          </Pressable>
          <TextInput
            style={inputStyle}
            value={String(minutes).padStart(2, '0')}
            keyboardType="numeric"
            maxLength={2}
            onChangeText={(v) => { const n = parseInt(v, 10); if (!isNaN(n)) emit(hours, clamp(n, 0, 59)); }}
          />
          <Pressable style={btnStyle} onPress={() => step('m', -5)}>
            <Text style={{ color: palette.gray900, fontSize: 16 }}>▼</Text>
          </Pressable>
        </View>

        <Text style={{ color: palette.gray500, fontSize: 12, marginLeft: 4 }}>HH : MM</Text>
      </View>
    </View>
  );
}
