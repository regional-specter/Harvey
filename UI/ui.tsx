// UI/ui.tsx
import React, { useState, useEffect, useRef } from 'react';
import { render, Box, Text, useInput, useApp } from 'ink';
import Gradient from 'ink-gradient';
import Spinner from 'ink-spinner';
import { Marked } from 'marked';
import { markedTerminal } from 'marked-terminal';

import fs from 'fs'; // For file system operations (suggestions)

// Import agent core logic. Assumes agent/ directory is a sibling to UI/
import { initializeAgent, handleUserInput, setAgentLogger } from '../agent/index.js'; 

const marked = new Marked(new markedTerminal());

const HEADER_ASCII = `

██╗  ██╗ █████╗ ██████╗ ██╗   ██╗███████╗██╗   ██╗
██║  ██║██╔══██╗██╔══██╗██║   ██║██╔════╝╚██╗ ██╔╝
███████║███████║██████╔╝██║   ██║█████╗   ╚████╔╝ 
██╔══██║██╔══██║██╔══██╗╚██╗ ██╔╝██╔══╝    ╚██╔╝  
██║  ██║██║  ██║██║  ██║ ╚████╔╝ ███████╗   ██║   
╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝  ╚═══╝  ╚══════╝   ╚═╝
`.trim();

// --- Type Definitions ---
interface ToolCall {
    toolName: string;
    toolInput: string;
    duration: string;
    error?: any;
}

interface Message {
    type: 'user' | 'agent';
    content: React.ReactNode;
    allToolCalls?: ToolCall[];
}

const Header = () => {
    const headerLines = HEADER_ASCII.split('\n');
    return (
        <Box flexDirection="column" alignItems="left" paddingBottom={1}>
            <Box flexDirection="column">
                    <Text bold color="#6c757d">{headerLines[0]}</Text>
                    <Text bold color="#6c757d">{headerLines[1]}</Text>
                    <Text bold color="#495057">{headerLines[2]}</Text>
                    <Text bold color="#495057">{headerLines[3]}</Text>
                    <Text bold color="#343a40">{headerLines[4]}</Text>
                    <Text bold color="#343a40">{headerLines[5]}</Text>
                </Box>
            
            <Box marginTop={1} width={80}>
                <Text color="gray" dimColor italic wrap="wrap" textAlign="left">
                    An intelligent research agent that tracks your goals, recalls contextually relevant 
                    information, and reasons across long, interleaved tasks to provide precise insights.
                </Text>
            </Box>
        </Box>
    );
};

// --- New SingleToolCallDisplay Component ---
const SingleToolCallDisplay = ({ toolName, toolInput, duration, error }: ToolCall) => {
    if (error) {
        return (
            <Box flexDirection="column" marginBottom={1} marginLeft={2}>
                <Text color="red">{toolName} ("{toolInput}") - FAILED</Text>
                <Box marginLeft={2}>
                    <Text color="gray">└ Error: {error.toString()}</Text>
                </Box>
            </Box>
        );
    }

    return (
        <Box flexDirection="column" marginBottom={1} marginLeft={2}>
            <Text color="green">{toolName} ("{toolInput}")</Text>
            <Box marginLeft={2}>
                <Text>└ in {duration}ms</Text>
            </Box>
        </Box>
    );
};

const ChatHistory = ({ messages }: { messages: Message[] }) => (
    <Box flexDirection="column" paddingBottom={1}>
        {messages.map((message, index) => (
            <React.Fragment key={index}>
                {message.type === 'user' && (
                    <Text color="cyan">{`> ${message.content}`}</Text>
                )}
                {message.type === 'agent' && (
                    <Box flexDirection="column">
                        {message.allToolCalls && message.allToolCalls.length > 0 && (
                            <Box flexDirection="column" marginLeft={2}>
                                {message.allToolCalls.map((toolCall, tcIndex) => (
                                    <SingleToolCallDisplay key={tcIndex} {...toolCall} />
                                ))}
                            </Box>
                        )}
                        <Text color="green">Agent:</Text>
                        <Text>{message.content}</Text>
                    </Box>
                )}
            </React.Fragment>
        ))}
    </Box>
);

// ... (LogBox, LoadingSpinner, InputBox, FileSuggestions remain the same)
const LogBox = ({ logMessages }) => {
    if (logMessages.length === 0) {
        return null;
    }
    return (
        <Box flexDirection="column" paddingY={1} width="100%">
            <Text dimColor>--- Agent Logs ---</Text>
            {logMessages.map((msg, index) => (
                <Text key={index} color="gray" dimColor wrap="truncate">
                    {msg}
                </Text>
            ))}
        </Box>
    );
};

const LoadingSpinner = () => (
    <Box>
        <Text color="green">
            <Spinner type="dots" />
            {' Processing...'}
        </Text>
    </Box>
);

// InputBox displays the current input value and a cursor.
const InputBox = ({ value }) => {
    // Basic logic for showing '@' prefix for file suggestions.
    const parts = value.split(/(@\S*)/); 
    return (
        <Box borderStyle="single" paddingX={1} marginBottom={1}>
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

// Component to display file suggestions.
const FileSuggestions = ({ suggestions, activeIndex, filterText }) => {
    if (suggestions.length === 0) return null;

    const filteredSuggestions = suggestions
        .filter(s => s.toLowerCase().includes(filterText.toLowerCase()))
        .slice(0, 5);

    if (filteredSuggestions.length === 0) return null;

    return (
        <Box flexDirection="column" borderStyle="single" width="100%" paddingX={1}>
            {filteredSuggestions.map((suggestion, index) => {
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
    const [messages, setMessages] = useState<Message[]>([]);
    const [logMessages, setLogMessages] = useState<string[]>([]);
    const [inputValue, setInputValue] = useState(''); 
    const [suggestions, setSuggestions] = useState<string[]>([]); 
    const [suggestionBoxVisible, setSuggestionBoxVisible] = useState(false); 
    const [activeIndex, setActiveIndex] = useState(0); 
    const [isAgentReady, setIsAgentReady] = useState(false); 
    const [isLoading, setIsLoading] = useState(false);

    const inputValueRef = useRef(inputValue);
    inputValueRef.current = inputValue;

    useEffect(() => {
        setAgentLogger((logMessage) => {
            setLogMessages(prevLogs => [...prevLogs, logMessage].slice(-12));
        });

        const init = async () => {
            const success = await initializeAgent();
            if (success) {
                setMessages((prev) => [
                    ...prev,
                    { type: 'agent', content: <Text color="green">Agent initialized successfully.</Text> }
                ]);
                setIsAgentReady(true);
            } else {
                setMessages((prev) => [
                    ...prev,
                    { type: 'agent', content: <Text color="red">Agent failed to initialize. Please check logs.</Text> }
                ]);
            }
        };
        init();
    }, []);

    useEffect(() => {
        if (suggestionBoxVisible) {
            fs.readdir(process.cwd(), (err, files) => {
                if (err) {
                    setSuggestions([]);
                } else {
                    setSuggestions(files.filter(f => !f.startsWith('.') && f !== 'node_modules'));
                }
            });
        } else {
            setSuggestions([]);
            setActiveIndex(0);
        }
    }, [suggestionBoxVisible]);

    useInput((input, key) => {
        if (key.ctrl && key.name === 'c') {
            exit();
            return;
        }

        if (!isAgentReady && !(key.ctrl && key.name === 'c')) return;

        if (key.return) {
            const submittedInput = inputValueRef.current.trim();
            setInputValue('');

            if (submittedInput === '') return;

            setMessages((prev) => [
                ...prev,
                { type: 'user', content: submittedInput }
            ]);

            setIsLoading(true);
            (async () => {
                let agentOutput;
                try {
                    agentOutput = await handleUserInput(submittedInput);
                } catch (e: any) {
                    agentOutput = {
                        response: `An unexpected error occurred: ${e.message}`,
                        toolCall: null
                    };
                }
                setIsLoading(false);

                const { response, allToolCalls } = agentOutput;
                const formattedResponse = marked.parse(response).trim();

                setMessages((prev) => [
                    ...prev,
                    {
                        type: 'agent',
                        content: formattedResponse,
                        allToolCalls: allToolCalls || undefined
                    }
                ]);
            })();
        } else if (key.backspace || key.delete) {
            setInputValue(inputValueRef.current.slice(0, -1));
        } else {
            const newValue = inputValueRef.current + input;
            setInputValue(newValue);
            if (newValue.endsWith('@')) setSuggestionBoxVisible(true);
        }
    });

    return (
        <Box flexDirection="column" width="100%" height="100%">
            <Header />
            <ChatHistory messages={messages} />
            <Box flexGrow={1} />
            <LogBox logMessages={logMessages} />
            {isLoading && <LoadingSpinner />}
            <InputBox value={inputValue} />
            {suggestionBoxVisible && (
                <FileSuggestions 
                    suggestions={suggestions} 
                    activeIndex={activeIndex} 
                    filterText={inputValue.split('@').pop() || ''}
                />
            )}
        </Box>
    );
};

render(<App />);
