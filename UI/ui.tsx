import React, { useState, useEffect } from 'react';
import { render, Box, Text, useInput, useApp } from 'ink';
import Gradient from 'ink-gradient';
import fs from 'fs';

const HEADER_ASCII = `
██╗  ██╗ █████╗ ██████╗ ██╗   ██╗███████╗██╗   ██╗
██║  ██║██╔══██╗██╔══██╗██║   ██║██╔════╝╚██╗ ██╔╝
███████║███████║██████╔╝██║   ██║█████╗   ╚████╔╝ 
██╔══██║██╔══██║██╔══██╗╚██╗ ██╔╝██╔══╝    ╚██╔╝  
██║  ██║██║  ██║██║  ██║ ╚████╔╝ ███████╗   ██║   
╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝  ╚═══╝  ╚══════╝   ╚═╝
`.trim();

const Header = () => (
    <Box flexDirection="column" alignItems="center" paddingBottom={1}>
        {/* Use the Gradient component here */}
        <Gradient name="passion">
            <Text bold>
                {HEADER_ASCII}
            </Text>
        </Gradient>
        
        <Box marginTop={1} width={80}>
            <Text color="gray" dimColor italic wrap="wrap" textAlign="center">
		  	An intelligent research agent that tracks your goals, recalls contextually relevant information, and reasons across long, interleaved tasks to provide precise insights
            </Text>
        </Box>
    </Box>
);

const ChatHistory = ({ history }) => (
	<Box flexDirection="column" paddingBottom={1}>
		{history.map((message, index) => (
			<Text key={index}>{message}</Text>
		))}
	</Box>
);

const InputBox = ({ value }) => {
	const parts = value.split(/(@\S+)/);
	return (
		<Box borderStyle="single" paddingX={1}>
			<Text>
				{parts.map((part, i) => {
					if (part.startsWith('@')) {
						return (
							<Text key={i} color="red">
								{part}
							</Text>
						);
					}
					return part;
				})}
				█
			</Text>
		</Box>
	);
};

const FileSuggestions = ({ suggestions, activeIndex }) => {
	if (suggestions.length === 0) {
		return null;
	}

	return (
		<Box flexDirection="column" borderStyle="single" width={80}>
			{suggestions.map((suggestion, index) => {
				const color = index === activeIndex ? 'red' : 'white';
				return (
					<Text key={suggestion} color={color}>
						{suggestion}
					</Text>
				);
			})}
		</Box>
	);
};

const App = () => {
	const { exit } = useApp();
	const [history, setHistory] = useState([]);
	const [inputValue, setInputValue] = useState('');
	const [suggestions, setSuggestions] = useState<string[]>([]);
	const [suggestionBoxVisible, setSuggestionBoxVisible] = useState(false);
	const [activeIndex, setActiveIndex] = useState(0);

	useEffect(() => {
		if (suggestionBoxVisible) {
			fs.readdir(process.cwd(), (err, files) => {
				if (err) {
					// handle error
				} else {
					setSuggestions(files);
				}
			});
		}
	}, [suggestionBoxVisible]);

	useInput((input, key) => {
		if (key.ctrl && key.name === 'c') {
			exit();
		}

		if (suggestionBoxVisible) {
			if (key.upArrow) {
				setActiveIndex((prev) => (prev > 0 ? prev - 1 : suggestions.length - 1));
			} else if (key.downArrow) {
				setActiveIndex((prev) => (prev < suggestions.length - 1 ? prev + 1 : 0));
			} else if (key.return) {
				setInputValue(inputValue.slice(0, -1) + suggestions[activeIndex] + ' ');
				setSuggestionBoxVisible(false);
			} else if (key.backspace || key.delete) {
				setInputValue(inputValue.slice(0, -1));
				if(inputValue.slice(0, -1).endsWith('@') === false) {
					setSuggestionBoxVisible(false);
				}

			} else {
				setInputValue(inputValue + input);
			}
		} else {
			if (key.return) {
				setHistory([...history, `> ${inputValue}`, `Harvey: ${inputValue}`]);
				setInputValue('');
			} else if (key.backspace || key.delete) {
				setInputValue(inputValue.slice(0, -1));
			} else {
				if ((inputValue + input).endsWith('@')) {
					setSuggestionBoxVisible(true);
				}
				setInputValue(inputValue + input);
			}
		}
	});

	return (
		<Box flexDirection="column" width="100%" height="100%">
			<Header />
			<ChatHistory history={history} />
			<Box flexGrow={1} />
			<InputBox
				value={inputValue}
			/>
			{suggestionBoxVisible && (
				<FileSuggestions suggestions={suggestions} activeIndex={activeIndex} />
			)}
		</Box>
	);
};

render(<App />);