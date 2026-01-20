import React, { useState } from 'react';
import { render, Box, Text, useInput, useApp } from 'ink';

const Header = () => (
	<Box flexDirection="column" alignItems="center" paddingBottom={1}>
		<Text bold color="blue" transform={(str) => str.toUpperCase()}>
			██╗░░██╗░█████╗░██████╗░██╗░░░██╗███████╗██╗░░░██╗
			██║░░██║██╔══██╗██╔══██╗██║░░░██║██╔════╝╚██╗░██╔╝
			███████║███████║██████╔╝╚██╗░██╔╝█████╗░░░╚████╔╝░
			██╔══██║██╔══██║██╔══██╗░╚████╔╝░██╔══╝░░░░╚██╔╝░░
			██║░░██║██║░░██║██║░░██║░░╚██╔╝░░███████╗░░░██║░░░
			╚═╝░░╚═╝╚═╝░░╚═╝╚═╝░░╚═╝░░░╚═╝░░░╚══════╝░░░╚═╝░░░
		</Text>
		<Text color="gray">
		An intelligent research agent that tracks your goals, recalls contextually relevant information, and reasons across long, interleaved tasks to provide precise insights
		</Text>
	</Box>
);

const ChatHistory = ({ history }) => (
	<Box flexDirection="column" paddingBottom={1}>
		{history.map((message, index) => (
			<Text key={index}>{message}</Text>
		))}
	</Box>
);

const InputBox = ({ value, onChange, onSubmit }) => {
	useInput((input, key) => {
		if (key.return) {
			onSubmit(value);
		} else if (key.backspace || key.delete) {
			onChange(value.slice(0, -1));
		} else {
			onChange(value + input);
		}
	});

	return (
		<Box borderStyle="single" paddingX={1}>
			<Text>{value}</Text>
		</Box>
	);
};

const App = () => {
	const { exit } = useApp();
	const [history, setHistory] = useState([]);
	const [inputValue, setInputValue] = useState('');

	useInput((_, key) => {
		if (key.ctrl && key.name === 'c') {
			exit();
		}
	});

	const handleInputChange = (newValue) => {
		setInputValue(newValue);
	};

	const handleInputSubmit = (message) => {
		setHistory([...history, `> ${message}`, `Harvey: ${message}`]);
		setInputValue('');
	};

	return (
		<Box flexDirection="column" width="100%" height="100%">
			<Header />
			<ChatHistory history={history} />
			<Box flexGrow={1} />
			<InputBox
				value={inputValue}
				onChange={handleInputChange}
				onSubmit={handleInputSubmit}
			/>
		</Box>
	);
};

render(<App />);