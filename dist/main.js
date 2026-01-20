// ui.tsx
import React, { useState } from "react";
import { render, Box, Text, useInput, useApp } from "ink";
var Header = () => /* @__PURE__ */ React.createElement(Box, { flexDirection: "column", alignItems: "center", paddingBottom: 1 }, /* @__PURE__ */ React.createElement(Text, { bold: true, color: "blue", transform: (str) => str.toUpperCase() }, "\u2588\u2588\u2557\u2591\u2591\u2588\u2588\u2557\u2591\u2588\u2588\u2588\u2588\u2588\u2557\u2591\u2588\u2588\u2588\u2588\u2588\u2588\u2557\u2591\u2588\u2588\u2557\u2591\u2591\u2591\u2588\u2588\u2557\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557\u2588\u2588\u2557\u2591\u2591\u2591\u2588\u2588\u2557 \u2588\u2588\u2551\u2591\u2591\u2588\u2588\u2551\u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2557\u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2557\u2588\u2588\u2551\u2591\u2591\u2591\u2588\u2588\u2551\u2588\u2588\u2554\u2550\u2550\u2550\u2550\u255D\u255A\u2588\u2588\u2557\u2591\u2588\u2588\u2554\u255D \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2551\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2551\u2588\u2588\u2588\u2588\u2588\u2588\u2554\u255D\u255A\u2588\u2588\u2557\u2591\u2588\u2588\u2554\u255D\u2588\u2588\u2588\u2588\u2588\u2557\u2591\u2591\u2591\u255A\u2588\u2588\u2588\u2588\u2554\u255D\u2591 \u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2551\u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2551\u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2557\u2591\u255A\u2588\u2588\u2588\u2588\u2554\u255D\u2591\u2588\u2588\u2554\u2550\u2550\u255D\u2591\u2591\u2591\u2591\u255A\u2588\u2588\u2554\u255D\u2591\u2591 \u2588\u2588\u2551\u2591\u2591\u2588\u2588\u2551\u2588\u2588\u2551\u2591\u2591\u2588\u2588\u2551\u2588\u2588\u2551\u2591\u2591\u2588\u2588\u2551\u2591\u2591\u255A\u2588\u2588\u2554\u255D\u2591\u2591\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557\u2591\u2591\u2591\u2588\u2588\u2551\u2591\u2591\u2591 \u255A\u2550\u255D\u2591\u2591\u255A\u2550\u255D\u255A\u2550\u255D\u2591\u2591\u255A\u2550\u255D\u255A\u2550\u255D\u2591\u2591\u255A\u2550\u255D\u2591\u2591\u2591\u255A\u2550\u255D\u2591\u2591\u2591\u255A\u2550\u2550\u2550\u2550\u2550\u2550\u255D\u2591\u2591\u2591\u255A\u2550\u255D\u2591\u2591\u2591"), /* @__PURE__ */ React.createElement(Text, { color: "gray" }, "An intelligent research agent that tracks your goals, recalls contextually relevant information, and reasons across long, interleaved tasks to provide precise insights"));
var ChatHistory = ({ history }) => /* @__PURE__ */ React.createElement(Box, { flexDirection: "column", paddingBottom: 1 }, history.map((message, index) => /* @__PURE__ */ React.createElement(Text, { key: index }, message)));
var InputBox = ({ value, onChange, onSubmit }) => {
  useInput((input, key) => {
    if (key.return) {
      onSubmit(value);
    } else if (key.backspace || key.delete) {
      onChange(value.slice(0, -1));
    } else {
      onChange(value + input);
    }
  });
  return /* @__PURE__ */ React.createElement(Box, { borderStyle: "single", paddingX: 1 }, /* @__PURE__ */ React.createElement(Text, null, value));
};
var App = () => {
  const { exit } = useApp();
  const [history, setHistory] = useState([]);
  const [inputValue, setInputValue] = useState("");
  useInput((_, key) => {
    if (key.ctrl && key.name === "c") {
      exit();
    }
  });
  const handleInputChange = (newValue) => {
    setInputValue(newValue);
  };
  const handleInputSubmit = (message) => {
    setHistory([...history, `> ${message}`, `Harvey: ${message}`]);
    setInputValue("");
  };
  return /* @__PURE__ */ React.createElement(Box, { flexDirection: "column", width: "100%", height: "100%" }, /* @__PURE__ */ React.createElement(Header, null), /* @__PURE__ */ React.createElement(ChatHistory, { history }), /* @__PURE__ */ React.createElement(Box, { flexGrow: 1 }), /* @__PURE__ */ React.createElement(
    InputBox,
    {
      value: inputValue,
      onChange: handleInputChange,
      onSubmit: handleInputSubmit
    }
  ));
};
render(/* @__PURE__ */ React.createElement(App, null));
