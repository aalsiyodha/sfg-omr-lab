#!/usr/bin/env python3
"""Train the v2.5.2 6-way prototype head on PROCEDURALLY GENERATED features.

Requires numpy (development only). No user photograph or independent human
label is used. Synthetic validation accuracy must NOT be reported as an OMR
accuracy score. The handwritten sheet must be evaluated separately.

Run: python scripts/train_synthetic_decision.py
Copy rounded W/B output to src/scanner/trainedDecisionHead.ts after review.
"""
import numpy as np

rng = np.random.default_rng(251)
names = ["empty", "solid", "partial", "stroke", "hatching", "ring"]
# Feature order defined by decisionFeatures in trainedDecisionHead.ts.
means = np.array([
    [.02, .01, .02, .03, 0, 0, 0, 0, .02, .03],
    [.96, .97, .94, .88, .98, 1, 0, 0, .01, .05],
    [.55, .65, .42, .28, .55, .62, .1, .05, .35, .35],
    [.36, .35, .4, .28, .43, .62, .05, 1, .55, .55],
    [.55, .49, .62, .47, .8, .9, 1, .1, .3, .6],
    [.62, .10, .55, .88, .88, .95, 0, .05, .85, .25],
])
std = np.array([.12,.16,.17,.17,.18,.2,.08,.08,.15,.17])

def sample(count):
    y = rng.integers(0, 6, count)
    X = np.clip(means[y] + rng.normal(size=(count,10)) * std, 0, 1)
    X[:,6] = np.where(y==4, rng.uniform(.65,1,count), rng.uniform(0,.15,count))
    X[:,7] = np.where(y==3, rng.uniform(.65,1,count), rng.uniform(0,.15,count))
    return X,y

X,y = sample(18000)
W = np.zeros((10,6)); b = np.zeros(6)
learning_rate=.4; regularizer=.005
for _ in range(800):
    logits=X @ W + b
    logits-=logits.max(axis=1,keepdims=True)
    e=np.exp(logits); probs=e/e.sum(axis=1,keepdims=True)
    delta=(probs-np.eye(6)[y])/len(y)
    W-=learning_rate*(X.T@delta+regularizer*W)
    b-=learning_rate*delta.sum(axis=0)

heldout,truth=sample(5000)
synthetic_accuracy=float(np.mean(np.argmax(heldout@W+b,axis=1)==truth))
print("classes=",names)
print("W=",np.round(W,3).tolist())
print("B=",np.round(b,3).tolist())
print("SYNTHETIC-ONLY heldout accuracy=",synthetic_accuracy)
print("Real OMR accuracy and probability calibration: UNKNOWN")
