const fs = require('fs');
const path = require('path');

function findNestedButtons(dir) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isDirectory()) {
            findNestedButtons(fullPath);
        } else if (file.endsWith('.tsx')) {
            const content = fs.readFileSync(fullPath, 'utf8');
            // Simplified multi-line check for <button...><button
            const regex = /<button[^>]*>(?:(?!<\/button>).)*?<button/gs;
            let match;
            while ((match = regex.exec(content)) !== null) {
                const lineNo = content.substring(0, match.index).split('\n').length;
                console.log(`Potential nested button in ${fullPath} at line ${lineNo}`);
                console.log(`Snippet: ${match[0].substring(0, 100)}...\n`);
            }
            
            // Also check for <Button...><Button
            const regex2 = /<Button[^>]*>(?:(?!<\/Button>).)*?<Button/gs;
            while ((match = regex2.exec(content)) !== null) {
                const lineNo = content.substring(0, match.index).split('\n').length;
                console.log(`Potential nested Button component in ${fullPath} at line ${lineNo}`);
                console.log(`Snippet: ${match[0].substring(0, 100)}...\n`);
            }

            // Also check for mix: <button...><Button
            const regex3 = /<button[^>]*>(?:(?!<\/button>).)*?<Button/gs;
            while ((match = regex3.exec(content)) !== null) {
                const lineNo = content.substring(0, match.index).split('\n').length;
                console.log(`Potential nested mix (button->Button) in ${fullPath} at line ${lineNo}`);
                console.log(`Snippet: ${match[0].substring(0, 100)}...\n`);
            }

            // Also check for mix: <Button...><button
            const regex4 = /<Button[^>]*>(?:(?!<\/Button>).)*?<button/gs;
            while ((match = regex4.exec(content)) !== null) {
                const lineNo = content.substring(0, match.index).split('\n').length;
                console.log(`Potential nested mix (Button->button) in ${fullPath} at line ${lineNo}`);
                console.log(`Snippet: ${match[0].substring(0, 100)}...\n`);
            }
        }
    }
}

findNestedButtons('src');
