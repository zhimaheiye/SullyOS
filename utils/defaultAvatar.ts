/** 首字母色块默认头像。OSContext 与 Tavern JSON 导入共用；避免为了拿默认头像去调 addCharacter()（那会真的建一张空白卡）。 */
export const generateDefaultAvatar = (seed: string) => {
    const colors = ['FF9AA2', 'FFB7B2', 'FFDAC1', 'E2F0CB', 'B5EAD7', 'C7CEEA', 'e2e8f0', 'fcd34d', 'fca5a5'];
    const color = colors[seed.charCodeAt(0) % colors.length];
    const letter = seed.charAt(0).toUpperCase();
    return `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="%23${color}"/><text x="50" y="55" font-family="sans-serif" font-weight="bold" font-size="50" text-anchor="middle" dy=".3em" fill="white" opacity="0.9">${letter}</text></svg>`;
};
